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

  this.nextOperation = 'none';

  this.triggerRecovered = false;
  this.initialPortfolio = undefined;
  this.portfolio = undefined;

  this.backOhlcvNumber = 3;
  this.ohlcvChangePercentForClose = 0.05;

  this.addTalibIndicator('bb', 'bbands', this.settings);
  console.log(`Strategy talibbb initiated with settings ${JSON.stringify(this.settings, null, 2)}.`);
};

strategy.log = function(candle) {
  // console.log(candle);
};

const initialTriggers = {
  trailingStop: {
    trailPercentage: 5, // or: trailValue: 100
  },
  fixedStop: {
    stopPercentage: 4,
  }
};

strategy.onPortfolioChange = function(portfolio) {
  this.initialPortfolio = this.initialPortfolio || portfolio;
  this.portfolio = portfolio;
};

function checkLastNOhlcvForCloseSignal(self, price) {
  if (!!self.asyncIndicatorRunner
    && !!self.asyncIndicatorRunner.candleProps
    && !!self.asyncIndicatorRunner.candleProps.close) {
    const sliceArg = -1 * self.backOhlcvNumber;
    const prices = self.asyncIndicatorRunner.candleProps.close.slice(sliceArg);
    const ohlcvMinMax = [Math.min(...prices), Math.max(...prices)];
    if (!!self.portfolio) {
      if (self.portfolio.asset > 0 && price < ohlcvMinMax[1]) {
        const priceChangeInNOhlcv = (ohlcvMinMax[1] - price) / ohlcvMinMax[1];
        console.log(`LONG_POS: Price change in ${self.backOhlcvNumber} candles is ${priceChangeInNOhlcv}`);
        console.log(`Observed prices are ${prices}, current prices is ${price}`);
        return priceChangeInNOhlcv > self.ohlcvChangePercentForClose;
      }

      if (self.portfolio.asset < 0 && price > ohlcvMinMax[0]) {
        const priceChangeInNOhlcv = (price -  ohlcvMinMax[0]) / ohlcvMinMax[0];
        console.log(`SHORT_POS: Price change in ${self.backOhlcvNumber} candles is ${priceChangeInNOhlcv}`);
        console.log(`Observed prices are ${prices}, current prices is ${price}`);
        return priceChangeInNOhlcv > this.ohlcvChangePercentForClose;
      }
    }
  }

  return false;
}

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
        initialPrice: parseFloat(self.initialPortfolio.base)
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

function bandWidthFilterMin(middle, price, factor) {
  let minLower = middle * (1 - factor);
  let minUpper = middle * (1 + factor);
  return price > minUpper || price  < minLower;
}

function bandWidthFilterMax(lower, upper, halfWidth, middle, factor) {
  const width = !!halfWidth ? (upper - lower) / 2 : upper - lower;
  const actualFactor = width / middle;
  return actualFactor < factor;
}

function checkAndOperate(self, lower, upper, middle, price) {
  if (self.nextOperation === 'none') {
    console.log(`No action required, returning ...`);
    return;
  }

  console.log(`Checking whether to perform action: ${self.nextOperation}`);

  if (self.nextOperation === 'close') {
    self.advice('close');
    self.nextOperation = 'none';
    return;
  }

  let maxMstdFilter = !self.settings.widthFilter ? true : bandWidthFilterMax(lower, upper,
    self.settings.widthFilter.halfWidth, middle, self.settings.widthFilter.maxMstdPct);

  let minMstdFilter =  !self.settings.widthFilter ? true : bandWidthFilterMin(middle, price,
    self.settings.widthFilter.minMstdPct);

  if (!maxMstdFilter) {
    console.log(`Max MSTD Filter give a negative with settings\n: ${JSON.stringify(self.settings.widthFilter, null, 2)}`);
  }

  if (!minMstdFilter) {
    console.log(`Min MSTD Filter give a negative with settings\n: ${JSON.stringify(self.settings.widthFilter, null, 2)}`);
  }

  let willTrade = maxMstdFilter && minMstdFilter;

  if (self.nextOperation === 'long') {
    if (willTrade) {
      self.advice({
        direction: 'long',
        trigger: initialTriggers
      });
      self.nextOperation = 'none';
    }
    return;
  }

  if (self.nextOperation === 'close_then_long') {
    if (willTrade) {
      self.advice({
        direction: 'close_then_long',
        trigger: initialTriggers
      });
      self.nextOperation = 'none';
    } else {
      self.advice('close');
      self.nextOperation = 'long';
    }
    return;
  }

  if (self.nextOperation === 'short') {
    if (willTrade) {
      self.advice({
        direction: 'short',
        trigger: initialTriggers
      });
      self.nextOperation = 'none';
    }
    return;
  }

  if (self.nextOperation === 'close_then_short') {
    if (willTrade) {
      self.advice({
        direction: 'close_then_short',
        trigger: initialTriggers
      });
      self.nextOperation = 'none';
    } else {
      self.advice('close');
      self.nextOperation = 'short';
    }
  }
}

strategy.check = function (candle) {
  if (!this.triggerRecovered) {
    recoverOrder(this);
  }

  if (checkLastNOhlcvForCloseSignal(this, candle.close)) {
    console.log(`Triggering close by high volatility.`);
    this.advice('close');
    this.nextOperation = 'none';
    return;
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
        this.nextOperation = 'long';
      } else if(this.trend.zone === 'none')  {
        console.log('Previous zone not retrieved, will not advice.');
      } else {
        console.log('>>>>> SIGNALING ADVICE CLOSE_THEN_LONG <<<<<<<<<<<<');
        this.nextOperation = 'close_then_long';
      }
    }

    if (zone === 'bottom') {
      if (this.trend.zone === 'low') {
        console.log('>>>>> SIGNALING ADVICE SHORT <<<<<<<<<<<<');
        this.nextOperation = 'short';
      } else if(this.trend.zone === 'none')  {
        console.log('Previous zone not retrieved, will not advice.');
      } else {
        console.log('>>>>> SIGNALING ADVICE CLOSE_THEN_SHORT <<<<<<<<<<<<');
        this.nextOperation = 'close_then_short';
      }
    }

    if ((this.trend.zone === 'low' && zone === 'high') ||
      (this.trend.zone === 'high' && zone === 'low')) {
      console.log('>>>>> SIGNALING ADVICE CLOSE <<<<<<<<<<<<');
      this.nextOperation = 'close';
    }

    this.trend = {
      zone: zone,  // none, top, high, low, bottom
      duration: 0,
      persisted: false
    }
  }

  checkAndOperate(this, lower, upper, middle, price);
};

module.exports = strategy;
