var BB = require('./indicators/BB.js');
var strat = {};

// Prepare everything our strat needs
// TAlib optInMAType values:
//     SMA = 0
//     EMA = 1
//     WMA = 2
//     DEMA = 3
//     TEMA = 4
//     TRIMA = 5
//     KAMA = 6
//     MAMA = 7
//     T3 = 8
const avgWindow = 20;
strat.init = function() {
  // your code!
  console.log('initiating');
  this.requiredHistory = avgWindow;
  const talibBBSettings = {
    optInTimePeriod: avgWindow,
    optInNbDevUp: 2,
    optInNbDevDn: 2,
    optInMAType: 0
  };

  const simpleBBSettings = {
    TimePeriod: avgWindow,
    NbDevDn: 2,
    NbDevUp: 2
  };
  // Add TA-lib Bollinger band indicator
  this.addTalibIndicator('bbstrat', 'bbands', talibBBSettings);

  // Add a simple SMA Bollinger band indicator
  this.addIndicator('bb', 'BB', simpleBBSettings);
};

// // What happens on every new candle?
// strat.update = function(candle) {
//   // your code!
//   console.log('update');
// };
//
// // For debugging purposes.
// strat.log = function() {
//   // your code!
//   console.log('log');
// };

// Based on the newly calculated
// information, check if we should
// update or not.
strat.check = function(candle) {
  // // your check code start!
  // console.log('checking');
  // const result = this.talibIndicators.bbstrat.result;
  // const lower = result['outRealLowerBand'];
  // const medium = result['outRealMiddleBand'];
  // const upper = result['outRealUpperBand'];
  //
  // if (candle.close > upper) {
  //   this.advice('short');
  // }
  //
  // if (candle.close < lower) {
  //   this.advice('long');
  // }
  // // your check code end!

  const talibResult = this.talibIndicators.bbstrat.result;
  const simpleResult = this.indicators.bb;
  console.log("Talib BB results.");
  console.log(`    ${talibResult['outRealLowerBand']}`);
  console.log(`    ${talibResult['outRealMiddleBand']}`);
  console.log(`    ${talibResult['outRealUpperBand']}`);
  console.log("Simple BB results.");
  console.log(`    ${simpleResult.lower}`);
  console.log(`    ${simpleResult.middle}`);
  console.log(`    ${simpleResult.upper}`);
};

// // Optional for executing code
// // after completion of a backtest.
// // This block will not execute in
// // live use as a live gekko is
// // never ending.
// strat.end = function() {
//   // your code!
//   console.log('end');
// };

module.exports = strat;
