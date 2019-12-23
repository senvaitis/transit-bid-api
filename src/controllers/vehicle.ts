import async from "async";
import crypto from "crypto";
import nodemailer from "nodemailer";
import passport from "passport";
import * as ws from "ws";

import { User, UserDocument, AuthToken } from "../models/User";
import { Request, Response, NextFunction } from "express";
import { IVerifyOptions } from "passport-local";
import { WriteError } from "mongodb";
import { check, sanitize, validationResult } from "express-validator";
import "../config/passport";
import {Vehicle, VehicleDocument} from "../models/Vehicle";
import {getVehicleCoordinates} from "../util/locator";

/**
 * GET /vehicles
 * All vehicles.
 */
export const getAllVehicles = (req: Request, res: Response) => {
    Vehicle.find()
        .then(function (doc) {
            res.send({vehicles: doc});
        }).catch((err) => {
        res.status(400).send(err);
    });
};

/**
 * GET /vehicle
 * Find vehicle.
 */
export const getVehicle = (req: Request, res: Response) => {
    Vehicle.findById(req.params.id).then(function (vehicle: VehicleDocument) {

        getVehicleCoordinates(vehicle)
            .then(coordinates => {
                vehicle.latA = coordinates.coordinatesA.lat;
                vehicle.lngA = coordinates.coordinatesA.lng;
                vehicle.latB = coordinates.coordinatesB.lat;
                vehicle.lngB = coordinates.coordinatesB.lng;
                res.send(vehicle);
            }).catch((err) => {
            res.status(400).send(err);
        });
    }).catch((err) => {
        res.status(400).send(err);
    });
};

/**
 * POST /vehicle
 * Creates vehicle.
 */
export const createVehicle = (req: Request, res: Response) => {
    const item = {
        make: req.body.make,
        model: req.body.model,
        year: req.body.year,
        countryA: req.body.countryA,
        cityA: req.body.cityA,
        countryB: req.body.countryB,
        cityB: req.body.cityB,
        bodyStyle: req.body.bodyStyle,
        currentBid: ""
    };

    const data = new Vehicle(item);

    getVehicleCoordinates(data)
        .then(() => { // ignore coordinates
            data.save()
                .then((message) => {
                    res.send(message);
                }).catch((err) => {
                console.log(err);
                return res.status(400).json({
                    errorCode: "ERROR_CREATING_VEHICLE",
                    field: "-",
                    message: "Error creating vehicle",
                    helpUrl: "no-url"
                });
            });
        }).catch((err) => {
        res.status(400).send(err);
    });
};


/**
 * PUT /vehicle
 * Updates vehicle.
 */
export const updateVehicle = (req: Request, res: Response) => {
    Vehicle.findById(req.params.id, function (err, doc) {
        if (err) {
            res.status(400).send(err);
            // return reject({"error": "failed to retrieve car"});
        }
        doc.make = req.query.make;
        doc.model = req.query.model;
        doc.save();
    }).then((message) => {
        res.send(message);
    }).catch((err) => {
        res.status(400).send(err);
    });
};


/**
 * POST /vehicle TODO
 * Login page.
 */
export const bidForVehicle = (req: Request, res: Response) => {
    Vehicle.findById(
        req.params.id,
        (err, vehicle) => {
            if (err) {
                return res.status(400).send(err);
            }
            // check if bid is valid
            const amounts = vehicle.bids.map((o) => {
                return o.amount;
            });
            const minAmount = vehicle.bids.length ? Math.min(...amounts) : null;
            console.log("minAmount: " + minAmount);

            if ((req.body.amount < minAmount || minAmount === null) && req.body.amount > 0) {
                Vehicle.findByIdAndUpdate(
                    req.params.id,
                    {
                        $push: {
                            bids: {
                                amount: req.body.amount,
                                time: new Date()
                            }
                        },
                        currentBid: req.body.amount
                    },
                    {new: true},
                    (err, doc) => {
                        if (err) {
                            res.status(400).send(err);
                        } else {
                            res.send(doc);
                        }
                    }
                );
            } else {
                return res.status(400).json({
                    errorCode: "WRONG_BID",
                    field: "amount",
                    originalValue: req.body.amount,
                    message: "Bid amount should be lower than the last bid and higher than 0",
                    helpUrl: "no-url"
                });
            }

        }
    );

};

/**
 * GET /login
 * Login page.
 */
export const streamBids = (ws: ws, req: Request) => {
    const vehId = req.params.id;
    console.log("Streaming for vehicle: " + vehId);

    const filter: any = [{
        $match: {
            $and: [
                {"documentKey._id": {$eq: vehId}}, // TODO might cause troubles
                // {"documentKey._id": {$eq: new ObjectID(vehId)}},
                {operationType: "update"}]
        }
    }];

    const vehicleWatch = Vehicle.watch(filter).on("change", data => {
        ws.send("{'currentBid': " + data.updateDescription.updatedFields.currentBid + "}");
        console.log("sent: " + "{'currentBid': " + data.updateDescription.updatedFields.currentBid + "}");
    });

    ws.on("message", msg => {
        console.log(msg);
        Vehicle.findById(vehId).then(function (doc) {
            ws.send("{'currentBid': " + doc.currentBid + "}");
        }).catch((err) => {
            console.log(err);
            // res.status(400).send(err);
        });
    });

    ws.on("close", () => {
        console.log("WebSocket was closed");
        vehicleWatch.close();
    });
};

/**
 * GET /login
 * Login page.
 */
export const getLogin = (req: Request, res: Response) => {
    if (req.user) {
        return res.redirect("/");
    }
    res.render("account/login", {
        title: "Login"
    });
};

/**
 * POST /login
 * Sign in using email and password.
 */
export const postLogin = async (req: Request, res: Response, next: NextFunction) => {
    await check("email", "Email is not valid").isEmail().run(req);
    await check("password", "Password cannot be blank").isLength({min: 1}).run(req);
    // eslint-disable-next-line @typescript-eslint/camelcase
    await sanitize("email").normalizeEmail({ gmail_remove_dots: false }).run(req);

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        req.flash("errors", errors.array());
        return res.redirect("/login");
    }

    passport.authenticate("local", (err: Error, user: UserDocument, info: IVerifyOptions) => {
        if (err) { return next(err); }
        if (!user) {
            req.flash("errors", {msg: info.message});
            return res.redirect("/login");
        }
        req.logIn(user, (err) => {
            if (err) { return next(err); }
            req.flash("success", { msg: "Success! You are logged in." });
            res.redirect(req.session.returnTo || "/");
        });
    })(req, res, next);
};

/**
 * GET /logout
 * Log out.
 */
export const logout = (req: Request, res: Response) => {
    req.logout();
    res.redirect("/");
};

/**
 * GET /signup
 * Signup page.
 */
export const getSignup = (req: Request, res: Response) => {
    if (req.user) {
        return res.redirect("/");
    }
    res.render("account/signup", {
        title: "Create Account"
    });
};

/**
 * POST /signup
 * Create a new local account.
 */
export const postSignup = async (req: Request, res: Response, next: NextFunction) => {
    await check("email", "Email is not valid").isEmail().run(req);
    await check("password", "Password must be at least 4 characters long").isLength({ min: 4 }).run(req);
    await check("confirmPassword", "Passwords do not match").equals(req.body.password).run(req);
    // eslint-disable-next-line @typescript-eslint/camelcase
    await sanitize("email").normalizeEmail({ gmail_remove_dots: false }).run(req);

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        req.flash("errors", errors.array());
        return res.redirect("/signup");
    }

    const user = new User({
        email: req.body.email,
        password: req.body.password
    });

    User.findOne({ email: req.body.email }, (err, existingUser) => {
        if (err) { return next(err); }
        if (existingUser) {
            req.flash("errors", { msg: "Account with that email address already exists." });
            return res.redirect("/signup");
        }
        user.save((err) => {
            if (err) { return next(err); }
            req.logIn(user, (err) => {
                if (err) {
                    return next(err);
                }
                res.redirect("/");
            });
        });
    });
};

/**
 * GET /account
 * Profile page.
 */
export const getAccount = (req: Request, res: Response) => {
    res.render("account/profile", {
        title: "Account Management"
    });
};

/**
 * POST /account/profile
 * Update profile information.
 */
export const postUpdateProfile = async (req: Request, res: Response, next: NextFunction) => {
    await check("email", "Please enter a valid email address.").isEmail().run(req);
    // eslint-disable-next-line @typescript-eslint/camelcase
    await sanitize("email").normalizeEmail({ gmail_remove_dots: false }).run(req);

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        req.flash("errors", errors.array());
        return res.redirect("/account");
    }

    const user = req.user as UserDocument;
    User.findById(user.id, (err, user: UserDocument) => {
        if (err) { return next(err); }
        user.email = req.body.email || "";
        user.profile.name = req.body.name || "";
        user.profile.gender = req.body.gender || "";
        user.profile.location = req.body.location || "";
        user.profile.website = req.body.website || "";
        user.save((err: WriteError) => {
            if (err) {
                if (err.code === 11000) {
                    req.flash("errors", { msg: "The email address you have entered is already associated with an account." });
                    return res.redirect("/account");
                }
                return next(err);
            }
            req.flash("success", { msg: "Profile information has been updated." });
            res.redirect("/account");
        });
    });
};

/**
 * POST /account/password
 * Update current password.
 */
export const postUpdatePassword = async (req: Request, res: Response, next: NextFunction) => {
    await check("password", "Password must be at least 4 characters long").isLength({ min: 4 }).run(req);
    await check("confirmPassword", "Passwords do not match").equals(req.body.password).run(req);

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        req.flash("errors", errors.array());
        return res.redirect("/account");
    }

    const user = req.user as UserDocument;
    User.findById(user.id, (err, user: UserDocument) => {
        if (err) { return next(err); }
        user.password = req.body.password;
        user.save((err: WriteError) => {
            if (err) { return next(err); }
            req.flash("success", { msg: "Password has been changed." });
            res.redirect("/account");
        });
    });
};

/**
 * POST /account/delete
 * Delete user account.
 */
export const postDeleteAccount = (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as UserDocument;
    User.remove({ _id: user.id }, (err) => {
        if (err) { return next(err); }
        req.logout();
        req.flash("info", { msg: "Your account has been deleted." });
        res.redirect("/");
    });
};

/**
 * GET /account/unlink/:provider
 * Unlink OAuth provider.
 */
export const getOauthUnlink = (req: Request, res: Response, next: NextFunction) => {
    const provider = req.params.provider;
    const user = req.user as UserDocument;
    User.findById(user.id, (err, user: any) => {
        if (err) { return next(err); }
        user[provider] = undefined;
        user.tokens = user.tokens.filter((token: AuthToken) => token.kind !== provider);
        user.save((err: WriteError) => {
            if (err) { return next(err); }
            req.flash("info", { msg: `${provider} account has been unlinked.` });
            res.redirect("/account");
        });
    });
};

/**
 * GET /reset/:token
 * Reset Password page.
 */
export const getReset = (req: Request, res: Response, next: NextFunction) => {
    if (req.isAuthenticated()) {
        return res.redirect("/");
    }
    User
        .findOne({ passwordResetToken: req.params.token })
        .where("passwordResetExpires").gt(Date.now())
        .exec((err, user) => {
            if (err) { return next(err); }
            if (!user) {
                req.flash("errors", { msg: "Password reset token is invalid or has expired." });
                return res.redirect("/forgot");
            }
            res.render("account/reset", {
                title: "Password Reset"
            });
        });
};

/**
 * POST /reset/:token
 * Process the reset password request.
 */
export const postReset = async (req: Request, res: Response, next: NextFunction) => {
    await check("password", "Password must be at least 4 characters long.").isLength({ min: 4 }).run(req);
    await check("confirm", "Passwords must match.").equals(req.body.password).run(req);

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        req.flash("errors", errors.array());
        return res.redirect("back");
    }

    async.waterfall([
        function resetPassword(done: Function) {
            User
                .findOne({ passwordResetToken: req.params.token })
                .where("passwordResetExpires").gt(Date.now())
                .exec((err, user: any) => {
                    if (err) { return next(err); }
                    if (!user) {
                        req.flash("errors", { msg: "Password reset token is invalid or has expired." });
                        return res.redirect("back");
                    }
                    user.password = req.body.password;
                    user.passwordResetToken = undefined;
                    user.passwordResetExpires = undefined;
                    user.save((err: WriteError) => {
                        if (err) { return next(err); }
                        req.logIn(user, (err) => {
                            done(err, user);
                        });
                    });
                });
        },
        function sendResetPasswordEmail(user: UserDocument, done: Function) {
            const transporter = nodemailer.createTransport({
                service: "SendGrid",
                auth: {
                    user: process.env.SENDGRID_USER,
                    pass: process.env.SENDGRID_PASSWORD
                }
            });
            const mailOptions = {
                to: user.email,
                from: "express-ts@starter.com",
                subject: "Your password has been changed",
                text: `Hello,\n\nThis is a confirmation that the password for your account ${user.email} has just been changed.\n`
            };
            transporter.sendMail(mailOptions, (err) => {
                req.flash("success", { msg: "Success! Your password has been changed." });
                done(err);
            });
        }
    ], (err) => {
        if (err) { return next(err); }
        res.redirect("/");
    });
};

/**
 * GET /forgot
 * Forgot Password page.
 */
export const getForgot = (req: Request, res: Response) => {
    if (req.isAuthenticated()) {
        return res.redirect("/");
    }
    res.render("account/forgot", {
        title: "Forgot Password"
    });
};

/**
 * POST /forgot
 * Create a random token, then the send user an email with a reset link.
 */
export const postForgot = async (req: Request, res: Response, next: NextFunction) => {
    await check("email", "Please enter a valid email address.").isEmail().run(req);
    // eslint-disable-next-line @typescript-eslint/camelcase
    await sanitize("email").normalizeEmail({ gmail_remove_dots: false }).run(req);

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        req.flash("errors", errors.array());
        return res.redirect("/forgot");
    }

    async.waterfall([
        function createRandomToken(done: Function) {
            crypto.randomBytes(16, (err, buf) => {
                const token = buf.toString("hex");
                done(err, token);
            });
        },
        function setRandomToken(token: AuthToken, done: Function) {
            User.findOne({ email: req.body.email }, (err, user: any) => {
                if (err) { return done(err); }
                if (!user) {
                    req.flash("errors", { msg: "Account with that email address does not exist." });
                    return res.redirect("/forgot");
                }
                user.passwordResetToken = token;
                user.passwordResetExpires = Date.now() + 3600000; // 1 hour
                user.save((err: WriteError) => {
                    done(err, token, user);
                });
            });
        },
        function sendForgotPasswordEmail(token: AuthToken, user: UserDocument, done: Function) {
            const transporter = nodemailer.createTransport({
                service: "SendGrid",
                auth: {
                    user: process.env.SENDGRID_USER,
                    pass: process.env.SENDGRID_PASSWORD
                }
            });
            const mailOptions = {
                to: user.email,
                from: "hackathon@starter.com",
                subject: "Reset your password on Hackathon Starter",
                text: `You are receiving this email because you (or someone else) have requested the reset of the password for your account.\n\n
          Please click on the following link, or paste this into your browser to complete the process:\n\n
          http://${req.headers.host}/reset/${token}\n\n
          If you did not request this, please ignore this email and your password will remain unchanged.\n`
            };
            transporter.sendMail(mailOptions, (err) => {
                req.flash("info", { msg: `An e-mail has been sent to ${user.email} with further instructions.` });
                done(err);
            });
        }
    ], (err) => {
        if (err) { return next(err); }
        res.redirect("/forgot");
    });
};
