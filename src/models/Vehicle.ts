import mongoose from "mongoose";

export type VehicleDocument = mongoose.Document & {
    make: string;
    model: string;
    year: string;
    countryA: string;
    cityA: string;
    countryB: string;
    latA: string;
    lngA: string;
    latB: string;
    lngB: string;
    cityB: string;
    bodyStyle: string;
    bids: [{
        amount: number;
        time: string;
    }];
    currentBid: number;
};

const vehicleSchema = new mongoose.Schema({
    make: { type: String },
    model: { type: String },
    year: { type: String },
    countryA: { type: String },
    cityA: { type: String },
    countryB: { type: String },
    cityB: { type: String },
    latA: { type: String },
    lngA: { type: String },
    latB: { type: String },
    lngB: { type: String },
    bodyStyle: { type: String },
    bids: [{
        amount: Number,
        time: {type: Date}
    }],
    currentBid: {
        type: Number
    }
}, { collection: "vehicles", timestamps: true });

export const Vehicle = mongoose.model<VehicleDocument>("Vehicle", vehicleSchema);
