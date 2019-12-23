import path from "path";
import fs from "fs";
import papaparse from "papaparse";
import {VehicleDocument} from "../models/Vehicle";

export interface Coordinates {
    coordinatesA: {
        lat: string;
        lng: string;
    };
    coordinatesB: {
        lat: string;
        lng: string;
    };
}

/**
 * GET /vehicle
 * Find vehicle.
 */
export const getVehicleCoordinates = (vehicle: VehicleDocument): Promise<Coordinates> => {
    return new Promise((resolve, reject) => {
        const p = path.join(path.join(__dirname, "../public"), "/worldcities.csv");

        const contents = fs.readFileSync(p, "utf8");
        const csvData = papaparse.parse(contents, {header: true}).data;

        const cityA = csvData.filter((data: { city_ascii: string; country: string; }) => data.city_ascii === vehicle.cityA && data.country === vehicle.countryA)[0];

        if (cityA === undefined) reject({
            errorCode: "ORIGIN_COUNTRY_OR_CITY_NOT_FOUND",
            field: "countryA, cityA",
            originalValue: vehicle.cityA,
            message: "Origin city or country not found",
            helpUrl: "no-url"
        });

        const cityB = csvData.filter((data: { city_ascii: string; country: string }) => data.city_ascii === vehicle.cityB && data.country === vehicle.countryB)[0];

        if (cityB === undefined) reject({
            errorCode: "DESTINATION_COUNTRY_OR_CITY_NOT_FOUND",
            field: "countryB, cityB",
            originalValue: vehicle.cityB,
            message: "Destination city or country not found",
            helpUrl: "no-url"
        });

        resolve({
            coordinatesA: {
                lat: cityA.lat,
                lng: cityA.lng
            },
            coordinatesB: {
                lat: cityB.lat,
                lng: cityB.lng
            }
        });
    });
};
