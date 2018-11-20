log = require('../core/log.js');
const strat = {};
/*
 * TA-lib optInMAType values:
 *     +-------+---+
 *     | SMA   | 0 |
 *     +-------+---+
 *     | EMA   | 1 |
 *     +-------+---+
 *     | WMA   | 2 |
 *     +-------+---+
 *     | DEMA  | 3 |
 *     +-------+---+
 *     | TEMA  | 4 |
 *     +-------+---+
 *     | TRIMA | 5 |
 *     +-------+---+
 *     | KAMA  | 6 |
 *     +-------+---+
 *     | MAMA  | 7 |
 *     +-------+---+
 *     | T3    | 8 |
 *     +-------+---+
 */
strat.init = function () {
  console.log('initiating');
  this.trend = {
    zone: 'none',  // none, top, high, low, bottom
    duration: 0,
    persisted: false
  };
  const talibBBSettings = {
    optInTimePeriod: this.tradingAdvisor.historySize,
    optInNbDevUp: 1,
    optInNbDevDn: 1,
    optInMAType: 0
  };

  // Add TA-lib Bollinger band indicator
  this.addTalibIndicator('bb', 'bbands', talibBBSettings);
};

strat.log = function(candle) {
  console.log(candle);
};

strat.check = function (candle) {
  const BB = this.talibIndicators.bb.result;
  const price = candle.close;

  // price Zone detection
  let zone = 'none';
  const upper = BB.outRealUpperBand;
  const middle = BB.outRealMiddleBand;
  const lower = BB.outRealLowerBand;

  if (price >= upper) zone = 'top';
  if ((price < upper) && (price >= middle)) zone = 'high';
  if ((price > lower) && (price < middle)) zone = 'low';
  if (price <= lower) zone = 'bottom';
  log.debug('current zone:  ', zone);

  if (this.trend.zone === zone) {
    // Ain't no zone change
    log.debug('persisted');
    this.trend = {
      zone: zone,  // none, top, high, low, bottom
      duration: this.trend.duration + 1,
      persisted: true
    };

    this.advice();
  }
  else {
    // There is a zone change
    log.debug('Leaving zone: ', this.trend.zone);
    if (this.trend.zone === 'top') {
      log.debug('>>>>> SIGNALING ADVICE LONG <<<<<<<<<<<<');
      this.advice('long');
    }

    if (this.trend.zone === 'bottom') {
      log.debug('>>>>> SIGNALING ADVICE SHORT <<<<<<<<<<<<');
      this.advice('short');
    }

    if (this.trend.zone === 'high') this.advice();
    if (this.trend.zone === 'low') this.advice();
    this.trend = {
      zone: zone,  // none, top, high, low, bottom
      duration: 0,
      persisted: false
    }
  }
};

module.exports = strat;
