log = require('../core/log.js');
const strategy = {};

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

  this.initialTriggers = {
    //trailingStop: {
    //  trailPercentage: 5, // or: trailValue: 100
    //},
    fixedStop: {
      stopPercentage: this.settings.fixedStopPercent,
    }
  };

  this.addIndicator('dt', 'DTH', this.settings);
  console.log(`Strategy DUAL_THRUST initiated with settings ${JSON.stringify(this.settings, null, 2)}.`);
};

strategy.log = function(candle) {
  // console.log(candle);
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
    const triggers = {
      fixedStop: {
        stopPercentage: self.settings.fixedStopPercent,
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

function checkAndOperate(self, lower, upper, price, zone) {
  if (self.nextOperation === 'none') {
    console.log(`No action required, returning ...`);
    return;
  }

  console.log(`Checking whether to perform action: ${self.nextOperation} in zone ${zone}`);

  // Add various custom filter result to willTrade.
  let willTrade = true;

  if (self.nextOperation === 'long') {
    if (willTrade && zone === 'long_zone') {
      self.advice({
        direction: 'long',
        trigger: self.initialTriggers
      });
      self.nextOperation = 'none';
    }
    return;
  }

  if (self.nextOperation === 'close_then_long') {
    if (willTrade && zone === 'long_zone') {
      self.advice({
        direction: 'close_then_long',
        trigger: self.initialTriggers
      });
      self.nextOperation = 'none';
    }
    return;
  }

  if (self.nextOperation === 'short') {
    if (willTrade && zone === 'short_zone') {
      self.advice({
        direction: 'short',
        trigger: self.initialTriggers
      });
      self.nextOperation = 'none';
    }
    return;
  }

  if (self.nextOperation === 'close_then_short') {
    if (willTrade && zone === 'short_zone') {
      self.advice({
        direction: 'close_then_short',
        trigger: self.initialTriggers
      });
      self.nextOperation = 'none';
    }
  }
}

strategy.check = function (candle) {
  if (!this.triggerRecovered) {
    recoverOrder(this);
  }

  if (!!this.settings.checkLastNOhlcv && checkLastNOhlcvForCloseSignal(this, candle.close)) {
    console.log(`Triggering close by high volatility.`);
    this.advice('close');
    this.nextOperation = 'none';
    return;
  }

  const DT = this.indicators.dt.result;
  if (!DT) {
    console.log(`Not warmed up yet, returning.`);
    return;
  }
  const price = candle.close;

  // price Zone detection
  let zone = 'none';
  const upper = DT.upperBand;
  const lower = DT.lowerBand;
  console.log(`METRICS: ${candle.start.format()}, ${candle.close}, ${upper}, ${lower}`);

  if (price > upper) zone = 'long_zone';
  if (price < lower) zone = 'short_zone';

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
    if (zone === 'long_zone') {
      if (!this.trend.zone) {
        console.log('>>>>> SIGNALING ADVICE LONG <<<<<<<<<<<<');
        this.nextOperation = 'long';
      } else {
        console.log('>>>>> SIGNALING ADVICE CLOSE_THEN_LONG <<<<<<<<<<<<');
        this.nextOperation = 'close_then_long';
      }

    }

    if (zone === 'short_zone') {
      if (!this.trend.zone) {
        console.log('>>>>> SIGNALING ADVICE SHORT <<<<<<<<<<<<');
        this.nextOperation = 'short';
      } else {
        console.log('>>>>> SIGNALING ADVICE CLOSE_THEN_SHORT <<<<<<<<<<<<');
        this.nextOperation = 'close_then_short';
      }
    }

    this.trend = {
      zone: zone,  // none, top, high, low, bottom
      duration: 0,
      persisted: false
    }
  }

  //checkAndOperate(this, lower, upper, price, zone);
};

module.exports = strategy;
