const _ = require('lodash');

const util = require('../../core/util');
const ENV = util.gekkoEnv();

const config = util.getConfig();
const calcConfig = config.paperTrader;
const watchConfig = config.watch;
const dirs = util.dirs();
const log = require(dirs.core + 'log');

const TrailingStop = require(dirs.broker + 'triggers/trailingStop');

const PaperTrader = function() {
  _.bindAll(this);

  if(calcConfig.feeUsing === 'maker') {
    this.rawFee = calcConfig.feeMaker;
  } else {
    this.rawFee = calcConfig.feeTaker;
  }

  this.fee = 1 - this.rawFee / 100;

  this.currency = watchConfig.currency;
  this.asset = watchConfig.asset;

  this.portfolio = {
    asset: calcConfig.simulationBalance.asset,
    currency: calcConfig.simulationBalance.currency,
  };

  this.balance = false;
  this.borrowed = 0;
  this.sellPrice = null;
  this.borrowStartDate = null;

  if(this.portfolio.asset > 0) {
    this.exposed = true;
  }

  this.propogatedTrades = 0;
  this.propogatedTriggers = 0;
};

PaperTrader.prototype.relayPortfolioChange = function() {
  this.deferredEmit('portfolioChange', {
    asset: this.portfolio.asset,
    currency: this.portfolio.currency
  });
};

PaperTrader.prototype.relayPortfolioValueChange = function() {
  this.deferredEmit('portfolioValueChange', {
    balance: this.getBalance()
  });
};

PaperTrader.prototype.extractFee = function(amount) {
  amount *= 1e8;
  amount *= this.fee;
  amount = Math.floor(amount);
  amount /= 1e8;
  return amount;
};

PaperTrader.prototype.setStartBalance = function() {
  this.balance = this.getBalance();
};

// after every succesfull trend ride we hopefully end up
// with more BTC than we started with, this function
// calculates Gekko's profit in %.
PaperTrader.prototype.updatePosition = function(advice) {

  let cost;
  let amount;
  let self = this;
  let what = advice.recommendation;

  function long() {
    if(self.portfolio.currency.free < 0) {
      return;
    }
    if (self.portfolio.asset === 0) {
      // Long to open: Confidence: 80%
      cost = (1 - self.fee) * self.portfolio.currency.free * calcConfig.leverageRatio;
      self.portfolio.asset +=
        self.extractFee(self.portfolio.currency.free * calcConfig.leverageRatio / self.price);
      amount = self.portfolio.asset;
      self.borrowed =
        self.portfolio.currency.free * (calcConfig.leverageRatio - 1);
      self.borrowStartDate = advice.date;
      self.portfolio.currency.free = 0;
      self.portfolio.currency.used = self.portfolio.currency.total - cost;
      self.portfolio.currency.total = self.portfolio.currency.used;

      self.exposed = true;
      self.trades++;
      self.tradeId = 'trade-' + (++self.propogatedTrades);
      return {action: 'buy', cost, amount, tradeId: self.tradeId};
    } else if (self.portfolio.asset < 0) {
      // Long to close: Confidence:
      cost = (1 - self.fee) * Math.abs(self.portfolio.asset * self.price);
      let timeDiff = Math.abs(advice.date.valueOf() - self.borrowStartDate.valueOf());
      let diffDays = Math.ceil(timeDiff / (1000 * 3600 * 24));
      let profit = (self.price - self.sellPrice) * self.portfolio.asset;
      self.portfolio.currency.free += self.portfolio.currency.total + profit - cost;
      self.portfolio.currency.free -= calcConfig.borrowDailyInterest * diffDays * self.borrowed;
      self.portfolio.currency.used = 0;
      self.portfolio.currency.total = self.portfolio.currency.free;
      amount = self.portfolio.asset;
      self.portfolio.asset = 0;

      self.exposed = false;
      self.trades++;
      self.tradeId = 'trade-' + (++self.propogatedTrades);
      return {action: 'buy', cost, amount, tradeId: self.tradeId};
    }

    return null;
  }

  function short() {
    if(self.portfolio.currency.free < 0) {
      return;
    }
    if (self.portfolio.asset === 0) {
      // Short to open: Confidence: 80%
      cost = (1 - self.fee) * self.portfolio.currency.free * calcConfig.leverageRatio;
      self.portfolio.asset -=
        self.extractFee(self.portfolio.currency.free * calcConfig.leverageRatio / self.price);
      amount = Math.abs(self.portfolio.asset);
      self.sellPrice = self.price;
      self.borrowed =
        self.portfolio.currency.free * (calcConfig.leverageRatio - 1);
      self.borrowStartDate = advice.date;
      self.portfolio.currency.free = 0;
      self.portfolio.currency.used = self.portfolio.currency.total - cost;
      self.portfolio.currency.total = self.portfolio.currency.used;

      self.exposed = true;
      self.trades++;
      self.tradeId = 'trade-' + (++self.propogatedTrades);
      return {action: 'sell', cost, amount, tradeId: self.tradeId};
    } else if (self.portfolio.asset > 0) {
      // Short to close: Confidence: 80%
      cost = (1 - self.fee) * (self.portfolio.asset * self.price);
      let timeDiff = Math.abs(advice.date.valueOf() - self.borrowStartDate.valueOf());
      let diffDays = Math.ceil(timeDiff / (1000 * 3600 * 24));
      self.portfolio.currency.free -= (1 + calcConfig.borrowDailyInterest * diffDays) * self.borrowed;
      self.portfolio.currency.free += self.extractFee(Math.abs(self.portfolio.asset * self.price));
      self.portfolio.currency.total = self.portfolio.currency.free;
      self.portfolio.currency.used = 0;
      amount = self.portfolio.asset;
      self.portfolio.asset = 0;

      self.exposed = false;
      self.trades++;
      self.tradeId = 'trade-' + (++self.self);
      return {action: 'sell', cost, amount, tradeId: self.tradeId};
    }

    return null;
  }

function emitEvents(r) {
    if (!r) {
      return;
    }
    self.deferredEmit('tradeInitiated', {
      id: r.tradeId,
      adviceId: r.id,
      action: r.action,
      portfolio: _.clone(self.portfolio),
      balance: self.getBalance(),
      date: r.date,
    });

    self.relayPortfolioChange();
    self.relayPortfolioValueChange();

    self.deferredEmit('tradeCompleted', {
      id: r.tradeId,
      adviceId: r.id,
      action: r.action,
      cont: r.cost,
      amount: r.amount,
      price: self.price,
      portfolio: self.portfolio,
      balance: self.getBalance(),
      date: r.date,
      effectivePrice: r.effectivePrice,
      feePercent: self.rawFee
    });
  }

  const effectivePrice = self.price * self.fee;

  function emitShortEvent() {
    let capitalInfo = short();
    if (!!capitalInfo) {
      emitEvents({effectivePrice, ...advice, ...capitalInfo});
    }
  }

  function emitLongEvent() {
    let capitalInfo = long();
    if (!!capitalInfo) {
      emitEvents({effectivePrice, ...advice, ...capitalInfo});
    }
  }

  // virtually trade all {currency} to {asset}
  // at the current price (minus fees)
  if(what === 'long') {
    emitLongEvent();
  } else if(what === 'short') {
    emitShortEvent();
  } else if(what === 'close') {
    if (this.portfolio.asset > 0) {
      emitShortEvent();
    } else if (this.portfolio.asset < 0) {
      emitLongEvent();
    }
  } else if(what === 'close_then_short') {
    if (self.portfolio.asset > 0) {
      emitShortEvent();
      emitShortEvent();
    } else if (self.portfolio.asset === 0) {
      emitShortEvent();
    }
  } else if(what === 'close_then_long') {
    if (self.portfolio.asset < 0) {
      emitLongEvent();
      emitLongEvent();
    } else if (self.portfolio.asset === 0) {
      emitLongEvent();
    }
  }
};

PaperTrader.prototype.getBalance = function() {
  if (this.portfolio.asset >= 0) {
    return this.portfolio.currency.free + this.price * this.portfolio.asset;
  } else {
    return this.portfolio.currency.used;
  }
};

PaperTrader.prototype.now = function() {
  return this.candle.start.clone().add(1, 'minute');
};

PaperTrader.prototype.processAdvice = function(advice) {
  let action;
  let self = this;

  function cancelActiveStopTrigger() {
    if(self.activeStopTrigger) {
      self.deferredEmit('triggerAborted', {
        id: self.activeStopTrigger.id,
        date: advice.date
      });

      delete self.activeStopTrigger;
    }
  }

  if(advice.recommendation === 'short') {
    action = 'sell';
    cancelActiveStopTrigger();
  } else if(advice.recommendation === 'long') {
    action = 'buy';
    if(advice.trigger) {
      // clean up potential old stop trigger
      cancelActiveStopTrigger();
      this.createTrigger(advice);
    }
  } else if(advice.recommendation === 'close') {
    cancelActiveStopTrigger();
  } else if(advice.recommendation === 'close_then_long') {
  } else if(advice.recommendation === 'close_then_short') {
  } else {
    return log.warn(
      `[Papertrader] ignoring unknown advice recommendation: ${advice.recommendation}`
    );
  }

  this.updatePosition(advice);
};

PaperTrader.prototype.createTrigger = function(advice) {
  const trigger = advice.trigger;

  if(trigger && trigger.type === 'trailingStop') {

    if(!trigger.trailValue) {
      return log.warn(`[Papertrader] ignoring trailing stop without trail value`);
    }

    const triggerId = 'trigger-' + (++this.propogatedTriggers);

    this.deferredEmit('triggerCreated', {
      id: triggerId,
      at: advice.date,
      type: 'trailingStop',
      proprties: {
        trail: trigger.trailValue,
        initialPrice: this.price,
      }
    });

    this.activeStopTrigger = {
      id: triggerId,
      adviceId: advice.id,
      instance: new TrailingStop({
        initialPrice: this.price,
        trail: trigger.trailValue,
        onTrigger: this.onStopTrigger
      })
    }
  } else {
    log.warn(`[Papertrader] Gekko does not know trigger with type "${trigger.type}".. Ignoring stop.`);
  }
};

PaperTrader.prototype.onStopTrigger = function() {

  const date = this.now();

  this.deferredEmit('triggerFired', {
    id: this.activeStopTrigger.id,
    date
  });

  const { cost, amount, effectivePrice } = this.updatePosition('short');

  this.relayPortfolioChange();
  this.relayPortfolioValueChange();

  this.deferredEmit('tradeCompleted', {
    id: this.tradeId,
    adviceId: this.activeStopTrigger.adviceId,
    action: 'sell',
    cost,
    amount,
    price: this.price,
    portfolio: this.portfolio,
    balance: this.getBalance(),
    date,
    effectivePrice,
    feePercent: this.rawFee
  });

  delete this.activeStopTrigger;
};

PaperTrader.prototype.processCandle = function(candle, done) {
  this.price = candle.close;
  this.candle = candle;

  if(!this.balance) {
    this.setStartBalance();
    this.relayPortfolioChange();
    this.relayPortfolioValueChange();
  }

  if(this.exposed) {
    this.relayPortfolioValueChange();
  }

  if(this.activeStopTrigger) {
    this.activeStopTrigger.instance.updatePrice(this.price);
  }

  done();
};

module.exports = PaperTrader;
