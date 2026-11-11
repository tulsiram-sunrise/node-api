const METERS_PER_MILE = 1609.344;

const milesToMeters = (miles) => miles * METERS_PER_MILE;
const metersToMiles = (meters) => meters / METERS_PER_MILE;

/** Convert an API {lat, lng} object into a GeoJSON Point ([lng, lat] order). */
const toPoint = ({ lat, lng }) => ({ type: "Point", coordinates: [lng, lat] });

module.exports = { milesToMeters, metersToMiles, toPoint };
