module.exports = () => {
    // Define converter function from miles to radian
    Number.prototype.milesToRadian = function () {
        let earthRadiusInMiles = 3959;
        return this / earthRadiusInMiles;
    };
};