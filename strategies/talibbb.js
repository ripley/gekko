log = require('../core/log.js');
const strategy = {};
/*
 * TA-lib optInMAType values:
 *     +-------+---+-------+---+-------+---+-------+---+-------+---+
 *     | SMA   | 0 | EMA   | 1 | WMA   | 2 | DEMA  | 3 | TEMA  | 4 |
 *     +-------+---+-------+---+-------+---+-------+---+-------+---+
 *     | TRIMA | 5 | KAMA  | 6 | MAMA  | 7 | T3    | 8 |
 *     +-------+---+-------+---+-------+---+-------+---+
 *
 * Parameters for bb indicator.
 *   let settings = {
 *     optInTimePeriod: 100,
 *     optInNbDevUp: 2,
 *     optInNbDevDn: 2,
 *     optInMAType: 0
 *   };
 *
 */
strategy.init = function () {
  console.log('initiating');
  this.trend = {
    zone: 'none',  // none, top, high, low, bottom
    duration: 0,
    persisted: false
  };

  this.triggerRecovered = false;
  this.initialPortfolio = undefined;

  this.addTalibIndicator('bb', 'bbands', this.settings);
  console.log(`Strategy talibbb initiated with settings ${JSON.stringify(this.settings, null, 2)}.`);
};

strategy.log = function(candle) {
  // console.log(candle);
};

strategy.onPortfolioChange = function(portfolio) {
  this.initialPortfolio = this.initialPortfolio || portfolio;
};

function recoverOrder(self) {
  if (self.triggerRecovered) {
    return;
  }

  if (!!self.initialPortfolio && !!self.asyncIndicatorRunner && !!self.asyncIndicatorRunner.candleProps) {
    const start = self.initialPortfolio.timestamp;
    const prices = self.asyncIndicatorRunner.candleProps.close;
    const timestamps = self.asyncIndicatorRunner.candleProps.start;
    const minMax = prices.map(function(p, i) {
      return [timestamps[i], p];
    }).filter(e => 
      e[0] / 1000 > start
    ).reduce((acc, val) => {
      acc[0] = ( acc[0] === undefined || val[1] < acc[0] ) ? val[1] : acc[0];
      acc[1] = ( acc[1] === undefined || val[1] > acc[1] ) ? val[1] : acc[1];
      return acc;
    }, []);

    const triggers = {
      trailingStop: {
        trailPercentage: 5, // or: trailValue: 100
        initialPrice: self.initialPortfolio.asset > 0 ? minMax[1] : minMax[0]
      },
      fixedStop: {
        stopPercentage: 4,
        initialPrice: parseInt(self.initialPortfolio.base)
      }
    };

    console.log(`Recovering trigger ${JSON.stringify(triggers, null, 2)}`);

    self.advice({
      direction: 'recover_trigger',
      trigger: triggers
    });
  }

  self.triggerRecovered = true;
}

strategy.check = function (candle) {
  if (!this.triggerRecovered) {
    recoverOrder(this);
  }

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

  function bandWidthFilter(lower, upper, halfWidth, price, factor) {
    const width = !!halfWidth ? (upper - lower) / 2 : upper - lower;
    const actualFactor = width / price;
    return actualFactor < factor;
  }

  let filterResult = true;

  if (!!this.settings.widthFilter) {
    filterResult = bandWidthFilter(lower, upper,
      this.settings.widthFilter.halfWidth, price, this.settings.widthFilter.factor);
    if (!filterResult) {
      console.log(`Filter widthFilter give a negative with settings\n: ${this.settings.widthFilter}`);
    }
  }

  // Chain other filters here.
  function filteredAdvice(self,order) {
    if(filterResult) {
      self.advice(order);
      return;
    }
    console.log(`Order ${order} rejected by filter !`);
  }

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
    const initialTriggers = {
      trailingStop: {
        trailPercentage: 5, // or: trailValue: 100
      },
      fixedStop: {
        stopPercentage: 4,
      }
    };

    // There is a zone change
    console.log('Leaving zone: ', this.trend.zone);
    if (zone === 'top') {
      if (this.trend.zone === 'high') {
        console.log('>>>>> SIGNALING ADVICE LONG <<<<<<<<<<<<');
        filteredAdvice(this, {
          direction: 'long', // or short
          trigger: initialTriggers
        });
      } else if(this.trend.zone === 'none')  {
        console.log('Previous zone not retrieved, will not advice.');
      } else {
        console.log('>>>>> SIGNALING ADVICE CLOSE_THEN_LONG <<<<<<<<<<<<');
        if (!filterResult) {
          this.advice('close');
        } else  {
          this.advice({
            direction: 'close_then_long', // or short
            trigger: initialTriggers
          });
        }
      }
    }

    if (zone === 'bottom') {
      if (this.trend.zone === 'low') {
        console.log('>>>>> SIGNALING ADVICE SHORT <<<<<<<<<<<<');
        filteredAdvice(this, {
          direction: 'short',
          trigger: initialTriggers
        });
      } else if(this.trend.zone === 'none')  {
        console.log('Previous zone not retrieved, will not advice.');
      } else {
        console.log('>>>>> SIGNALING ADVICE CLOSE_THEN_SHORT <<<<<<<<<<<<');
        if (!filterResult) {
          this.advice('close');
        } else  {
          this.advice({
            direction: 'close_then_short',
            trigger: initialTriggers
          });
        }
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
