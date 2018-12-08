log = require('../core/log.js');
const strategy = {};
/*
 * TA-lib optInMAType values:
 *     +-------+---+-------+---+-------+---+-------+---+-------+---+
 *     | SMA   | 0 | EMA   | 1 | WMA   | 2 | DEMA  | 3 | TEMA  | 4 |
 *     +-------+---+-------+---+-------+---+-------+---+-------+---+
 *     | TRIMA | 5 | KAMA  | 6 | MAMA  | 7 | T3    | 8 |
 *     +-------+---+-------+---+-------+---+-------+---+
 */
strategy.init = function () {
  console.log('initiating');
  this.trend = {
    zone: 'none',  // none, top, high, low, bottom
    duration: 0,
    persisted: false
  };
  let settings = {
    optInTimePeriod: 100,
    optInNbDevUp: 2,
    optInNbDevDn: 2,
    optInMAType: 0
  };

  this.addTalibIndicator('bb', 'bbands', this.settings);
  // this.addTalibIndicator('bb', 'bbands', settings);
};

strategy.log = function(candle) {
  // console.log(candle);
};

strategy.check = function (candle) {
  const BB = this.talibIndicators.bb.result;
  const price = candle.close;

  // price Zone detection
  let zone = 'none';
  const upper = BB.outRealUpperBand;
  const middle = BB.outRealMiddleBand;
  const lower = BB.outRealLowerBand;
  console.log(`METRICS: ${candle.start.format()}, ${candle.close}, ${upper}, ${middle}, ${lower}`);

  if (price >= upper) zone = 'top';
  if ((price < upper) && (price >= middle)) zone = 'high';
  if ((price > lower) && (price < middle)) zone = 'low';
  if (price <= lower) zone = 'bottom';
  console.log('previous zone:  ', this.trend.zone);
  console.log('current zone:  ', zone);

  if (this.trend.zone === zone) {
    // No zone change
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
    console.log('Leaving zone: ', this.trend.zone);
    if (zone === 'top') {
      if (this.trend.zone === 'high') {
        console.log('>>>>> SIGNALING ADVICE LONG <<<<<<<<<<<<');
        this.advice('long');
      } else {
        console.log('>>>>> SIGNALING ADVICE CLOSE_THEN_LONG <<<<<<<<<<<<');
        this.advice('close_then_long');
      }
    }

    if (zone === 'bottom') {
      if (this.trend.zone === 'low') {
        console.log('>>>>> SIGNALING ADVICE SHORT <<<<<<<<<<<<');
        this.advice('short');
      } else {
        console.log('>>>>> SIGNALING ADVICE CLOSE_THEN_SHORT <<<<<<<<<<<<');
        this.advice('close_then_short');
      }
    }

    if ((this.trend.zone === 'low' && zone === 'high') ||
      (this.trend.zone === 'high' && zone === 'low')) {
      console.log('>>>>> SIGNALING ADVICE CLOSE <<<<<<<<<<<<');
      this.advice('close');
    }

    this.trend = {
      zone: zone,  // none, top, high, low, bottom
      duration: 0,
      persisted: false
    }
  }
};

module.exports = strategy;
