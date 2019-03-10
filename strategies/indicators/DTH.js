/*
 * Dual Thrust
 */
let log = require('../../core/log');

let Indicator = function(settings) {
  this.input = 'candle';
  this.result = undefined;
  this.hist = [];
  this.size = 0;
  this.upperMultiplier = settings.upperMultiplier;
  this.lowerMultiplier = settings.lowerMultiplier;
  this.maxSize = settings.history;
};

Indicator.prototype.update = function(candle) {
  // We need sufficient history to get the right result.
  if (this.hist.length === this.maxSize) {
      this.hist.shift();
  }
  this.hist.push(candle);
  this.result = this.hist.length < this.maxSize ? undefined : this.calculate(candle);
  log.debug(`Calculated Dual Thrust indicator is ${JSON.stringify(this.result, null, 2)}`);
};

/*
 * Calculate indicator result
 */
Indicator.prototype.calculate = function(candle) {
  if (this.hist.length === 0) {
    this.result = undefined;
    return;
  }

  return this.hist.reduce((acc, val) => {
    acc.hh = ( !acc.hh || val.high > acc.hh ) ? val.high : acc.hh;
    acc.lc = ( !acc.lc || val.close < acc.lc ) ? val.close : acc.lc;
    acc.hc = ( !acc.hc || val.close > acc.hc ) ? val.close : acc.hc;
    acc.ll = ( !acc.ll || val.low < acc.ll ) ? val.low : acc.ll;
    acc.range = Math.max(acc.hh - acc.lc, acc.hc - acc.ll);
    acc.upperBand = candle.open + acc.range * this.upperMultiplier;
    acc.lowerBand = candle.open - acc.range * this.lowerMultiplier;
    return acc;
  }, {});

};

module.exports = Indicator;
