const _ = require('lodash');
const util = require('../../core/util.js');
const config = util.getConfig();
const dirs = util.dirs();
const moment = require('moment');

const log = require(dirs.core + 'log');
const Broker = require(dirs.broker + '/gekkoBroker');

require(dirs.gekko + '/exchange/dependencyCheck');

const Trader = function(next) {

  _.bindAll(this);

  this.brokerConfig = {
    ...config.trader,
    ...config.watch,
    private: true
  };

  this.propogatedTrades = 0;
  this.propogatedTriggers = 0;
  // this.leverageRatio = 3;

  this.activeStopTrigger = {};

  try {
    this.broker = new Broker(this.brokerConfig);
  } catch(e) {
    util.die(e.message);
  }

  if(!this.broker.capabilities.gekkoBroker) {
    util.die('This exchange is not yet supported');
  }

  this.sync(() => {
    log.info('\t', 'Portfolio:');
    log.info('\t\t', this.portfolio.currency, this.brokerConfig.currency);
    log.info('\t\t', this.portfolio.asset, this.brokerConfig.asset);
    log.info('\t', 'Balance:');
    log.info('\t\t', this.balance, this.brokerConfig.currency);
    log.info('\t', 'Exposed:');
    log.info('\t\t',
      this.exposedLong || this.exposedShort ? 'yes' : 'no',
      `(${(this.exposure * 100).toFixed(2)}%)`
    );
    next();
  });

  this.cancellingOrder = false;
  this.sendInitialPortfolio = false;
  this.activeDirection = null;

  setInterval(this.sync, 1000 * 60 * 10);
};

// teach our trader events
util.makeEventEmitter(Trader);

Trader.prototype.sync = function(next) {
  log.debug('syncing private data');
  this.broker.syncPrivateData(() => {
    if(!this.price) {
      this.price = this.broker.ticker.bid;
    }

    const oldPortfolio = this.portfolio;

    this.setPortfolio();
    this.setBalance();
    this.dumpPositionSettingAndPortfolioInfo();

    if(this.sendInitialPortfolio && !_.isEqual(oldPortfolio, this.portfolio)) {
      this.relayPortfolioChange();
    }

    // balance is relayed every minute
    // no need to do it here.

    if(next) {
      next();
    }
  });
};

Trader.prototype.relayPortfolioChange = function() {
  this.deferredEmit('portfolioChange', {
    asset: this.portfolio.asset,
    base: this.portfolio.base,
    timestamp: this.portfolio.timestamp,
    currency: this.portfolio.currency
  });
};

Trader.prototype.relayPortfolioValueChange = function() {
  this.deferredEmit('portfolioValueChange', {
    balance: this.balance
  });
};

Trader.prototype.dumpPositionSettingAndPortfolioInfo = function() {
  const balances = this.broker.portfolio.balances;
  let unallocated = 100;
  balances.filter(balance => balance.hasOwnProperty('amount') && balance.amount !== 0).forEach(balance => {
    unallocated -= this.brokerConfig.allocationRatio[balance.name];
  });

  log.info(`Calculating positionPercentage with unallocated: ${unallocated}, 
            allocation ratio: ${this.brokerConfig.allocationRatio[this.brokerConfig.asset]},
            for asset: ${this.brokerConfig.asset}`);
  const positionPercentage =
    unallocated > 0 ? this.brokerConfig.allocationRatio[this.brokerConfig.asset] / unallocated : 0;
  log.info(`Calculated positionPercentage: ${positionPercentage}`);
  log.info(`Current broker portfolio: ${JSON.stringify(this.broker.portfolio.balances, null, 2)}.`);
};

Trader.prototype.setPortfolio = function() {
  const balances = this.broker.portfolio.balances;
  let unallocated = 100;
  balances.filter(balance => balance.hasOwnProperty('amount') && balance.amount !== 0).forEach(balance => {
    unallocated -= this.brokerConfig.allocationRatio[balance.name];
  });

  const positionPercentage =
    unallocated > 0 ? this.brokerConfig.allocationRatio[this.brokerConfig.asset] / unallocated : 0;

  this.portfolio = {
    currency: _.find(
      balances,
      b => b.name === this.brokerConfig.currency
    ),
    asset: _.find(
      balances,
      b => b.name === this.brokerConfig.asset
    ).amount,
    base: _.find(
      balances,
      b => b.name === this.brokerConfig.asset
    ).base,
    timestamp: _.find(
      balances,
      b => b.name === this.brokerConfig.asset
    ).timestamp,
    positionPercentage: positionPercentage
  };
};

// Trader.prototype.setBalance = function() {
//   this.balance = this.portfolio.currency + this.portfolio.asset * this.price;
//   this.exposure = (this.portfolio.asset * this.price) / this.balance;
//   // if more than 10% of balance is in asset we are exposed
//   this.exposedLong = this.exposure > 0.1;
//   this.exposedShort = this.exposure < -0.1;
// }

Trader.prototype.setBalance = function() {
  // Balance in total amount of currency
  this.balance = this.portfolio.currency.total;
  // Exposure in value of asset, e.g.:eos.
  this.exposure = this.portfolio.asset * this.price;
  // if more than 10% of balance is in asset we are exposed
  let totalBalance = this.portfolio.currency.total;
  let usedBalance = this.portfolio.currency.used;
  let exposedRatio = usedBalance / totalBalance;

  this.exposedLong = this.exposure > 0 && exposedRatio > 0.1;
  this.exposedShort = this.exposure < 0 && exposedRatio > 0.1;
};

Trader.prototype.processCandle = function(candle, done) {
  this.price = candle.close;
  const previousBalance = this.balance;
  this.setPortfolio();
  this.setBalance();

  if(!this.sendInitialPortfolio) {
    this.sendInitialPortfolio = true;
    this.deferredEmit('portfolioChange', {
      asset: this.portfolio.asset,
      base: this.portfolio.base,
      timestamp: this.portfolio.timestamp,
      currency: this.portfolio.currency
    });
  }

  if(this.balance !== previousBalance) {
    // this can happen because:
    // A) the price moved and we have > 0 asset
    // B) portfolio got changed
    this.relayPortfolioValueChange();
  }

  done();
};

// Recover stoploss triggers
Trader.prototype.recoverOrCreateTriggers = function(advice, initialPrice) {
  if (!this.exposure){
    log.info(`Not exposed, won't recovery any trigger.`);
    return;
  }

  if(
    !!advice.trigger &&
    !!advice.trigger.trailingStopTrigger
  ) {
    const trigger = advice.trigger.trailingStopTrigger;
    const activeInitialPrice = !!initialPrice ? initialPrice : trigger.initialPrice;
    const triggerId = 'trigger-' + (++this.propogatedTriggers);

    this.deferredEmit('triggerCreated', {
      id: triggerId,
      at: advice.date,
      type: 'trailingStop',
      properties: {
        trail: trigger.trailValue,
        initialPrice: activeInitialPrice,
        exposure: this.exposure
      }
    });

    log.info(`Recovering trailingStop trigger "${triggerId}"! Properties:`);
    log.info(`\tInitial price: ${activeInitialPrice}`);
    log.info(`\tTrail of: ${trigger.trailValue}`);

    this.activeStopTrigger.trailingStopTrigger = {
      id: triggerId,
      adviceId: advice.id,
      instance: this.broker.createTrigger({
        type: 'trailingStop',
        onTrigger: this.onTrailingStopTrigger,
        props: {
          trail: trigger.trailValue,
          initialPrice: activeInitialPrice,
          exposure: this.exposure
        }
      })
    };
  }

  if(
    !!advice.trigger &&
    !!advice.trigger.fixedStopTrigger
  ) {
    const trigger = advice.trigger.fixedStopTrigger;
    const activeInitialPrice = !!initialPrice ? initialPrice : trigger.initialPrice;
    const triggerId = 'trigger-' + (++this.propogatedTriggers);

    this.deferredEmit('triggerCreated', {
      id: triggerId,
      at: advice.date,
      type: 'fixedStop',
      properties: {
        stopValue: trigger.stopValue,
        initialPrice: activeInitialPrice,
        exposure: this.exposure
      }
    });

    log.info(`Recovering fixedStop trigger "${triggerId}"! Properties:`);
    log.info(`\tInitial price: ${activeInitialPrice}`);
    log.info(`\tStop value is: ${trigger.stopValue}`);

    this.activeStopTrigger.fixedStopTriiger = {
      id: triggerId,
      adviceId: advice.id,
      instance: this.broker.createTrigger({
        type: 'fixedStop',
        onTrigger: this.onTrailingStopTrigger,
        props: {
          stopValue: trigger.stopValue,
          initialPrice: activeInitialPrice,
          exposure: this.exposure
        }
      })
    };
  }
};

Trader.prototype.cleanupStopTrigger = function(date){
  // clean up potential old stop trigger
  Object.keys(this.activeStopTrigger).forEach(t => {
    log.info(`Cleaning up stop trigger ${t}`);
    this.deferredEmit('triggerAborted', {
      id: this.activeStopTrigger[t].id,
      date: date
    });

    this.activeStopTrigger[t].instance.cancel();

    delete this.activeStopTrigger[t]
  });
};

Trader.prototype.processAdvice = function(advice) {
  let direction;

  if (advice.recommendation === 'recover_trigger') {
    this.recoverOrCreateTriggers(advice);
    return;
  }

  if(advice.recommendation === 'long') {
    direction = 'buy';
  } else if(advice.recommendation === 'short') {
    direction = 'sell';
  } else if(advice.recommendation === 'close') {
    direction = 'close';
  } else if(advice.recommendation === 'close_then_long') {
    direction = 'close_then_buy';
  } else if(advice.recommendation === 'close_then_short') {
    direction = 'close_then_sell';
  } else {
    log.error('ignoring advice in unknown direction');
    return;
  }

  const id = 'trade-' + (++this.propogatedTrades);

  if(this.order) {
    if(this.activeDirection === direction) {
      return log.info('ignoring advice: already in the process to', direction);
    }

    if(this.cancellingOrder) {
      return log.info('ignoring advice: already cancelling previous', this.order.side, 'order');
    }

    log.info('Received advice to', direction, 'however Gekko is already in the process to', this.order.side);
    log.info('Canceling', this.order.side, 'order first');
    return this.cancelOrder(id, advice, () => this.processAdvice(advice));
  }

  let amount;

  let orderDirection = '';
  let cb = null;
  //const multiplier = 0.95 * this.brokerConfig.leverageRatio * this.portfolio.positionPercentage;
  const multiplier = this.brokerConfig.leverageRatio * this.portfolio.positionPercentage;
  log.info(`Calculated multiplier: ${multiplier}`);

  if(direction === 'buy') {

    if(this.exposedLong) {
      log.info('NOT buying, already holding a long position');
      return this.deferredEmit('tradeAborted', {
        id,
        adviceId: advice.id,
        action: direction,
        portfolio: this.portfolio,
        balance: this.balance,
        reason: "Portfolio already in long position."
      });
    }

    // amount = this.portfolio.currency / this.price * 0.95;
    orderDirection = 'buy';
    amount = this.portfolio.currency.free * multiplier / this.price;

    log.info(
      'Trader',
      'Received advice to go long.',
      'Buying ', this.brokerConfig.asset
    );

  } else if(direction === 'sell') {

    if(this.exposedShort) {
      log.info('NOT selling, already holding a short position');
      return this.deferredEmit('tradeAborted', {
        id,
        adviceId: advice.id,
        action: direction,
        portfolio: this.portfolio,
        balance: this.balance,
        reason: "Portfolio already in short position."
      });
    }

    // amount = this.portfolio.asset;
    orderDirection = 'sell';
    amount = this.portfolio.currency.free * multiplier / this.price;

    log.info(
      'Trader',
      'Received advice to go short.',
      'Selling ', this.brokerConfig.asset
    );
  } else if(direction === 'close') {
    if(!this.exposedShort && !this.exposedLong) {
      log.info('NOT closing, holding very few long or short position');
      return this.deferredEmit('tradeAborted', {
        id,
        adviceId: advice.id,
        action: direction,
        portfolio: this.portfolio,
        balance: this.balance,
        reason: "Portfolio already in almost empty position."
      });
    }

    if (this.exposedLong) {
      orderDirection = 'sell';
    } else if (this.exposedShort) {
      orderDirection = 'buy';
    }

    this.cleanupStopTrigger(advice.date);
    amount = Math.abs(this.portfolio.asset);
  } else if(direction === 'close_then_buy') {
    if(this.exposedLong) {
      log.info('NOT closing then buy, already holding a long position');
      return this.deferredEmit('tradeAborted', {
        id,
        adviceId: advice.id,
        action: direction,
        portfolio: this.portfolio,
        balance: this.balance,
        reason: "Portfolio already in a long position."
      });
    }

    orderDirection = 'buy';
    if(this.exposedShort) {
      this.cleanupStopTrigger(advice.date);
      amount = Math.abs(this.portfolio.asset);
      cb = () => !!advice.trigger ?
        this.processAdvice({recommendation: 'long', trigger: advice.trigger}) :
        this.processAdvice({recommendation: 'long'})
    } else {
      amount = this.portfolio.currency.free * multiplier / this.price;
    }
  } else if(direction === 'close_then_sell') {
    if(this.exposedShort) {
      log.info('NOT closing then sell, already holding a short position');
      return this.deferredEmit('tradeAborted', {
        id,
        adviceId: advice.id,
        action: direction,
        portfolio: this.portfolio,
        balance: this.balance,
        reason: "Portfolio already in a short position."
      });
    }

    orderDirection = 'sell';
    if(this.exposedLong) {
      this.cleanupStopTrigger(advice.date);
      amount = Math.abs(this.portfolio.asset);
      cb = () => !!advice.trigger ?
        this.processAdvice({recommendation: 'short', trigger: advice.trigger}) :
        this.processAdvice({recommendation: 'short'})
    } else {
      amount = this.portfolio.currency.free * multiplier / this.price;
    }
  }

  if (!orderDirection) {
    log.info('NOT trading, direction not determined');
    return this.deferredEmit('tradeAborted', {
      id,
      adviceId: advice.id,
      action: direction,
      portfolio: this.portfolio,
      balance: this.balance,
      reason: "Failed to determine final trade direction."
    });
  }

  this.activeDirection = direction;
  this.createOrder(orderDirection, amount, advice, id, cb);
};

Trader.prototype.createOrder = function(side, amount, advice, id, cb) {
  const type = 'sticky';

  // NOTE: this is the best check we can do at this point
  // with the best price we have. The order won't be actually
  // created with this.price, but it should be close enough to
  // catch non standard errors (lot size, price filter) on
  // exchanges that have them.
  const check = this.broker.isValidOrder(amount, this.price);

  if(!check.valid) {
    log.warn('NOT creating order! Reason:', check.reason);
    return this.deferredEmit('tradeAborted', {
      id,
      adviceId: advice.id,
      action: side,
      portfolio: this.portfolio,
      balance: this.balance,
      reason: check.reason
    });
  }

  log.debug('Creating order to', side, amount, this.brokerConfig.asset);

  this.deferredEmit('tradeInitiated', {
    id,
    adviceId: advice.id,
    action: side,
    portfolio: this.portfolio,
    balance: this.balance
  });

  this.order = this.broker.createOrder(type, side, amount);

  this.order.on('fill', f => log.info('[ORDER] partial', side, 'fill, total filled:', f));
  this.order.on('statusChange', s => log.debug('[ORDER] statusChange:', s));

  this.order.on('error', e => {
    log.error('[ORDER] Gekko received error from GB:', e.message);
    log.debug(e);
    this.order = null;
    this.activeDirection = null;
    this.cancellingOrder = false;

    this.deferredEmit('tradeErrored', {
      id,
      adviceId: advice.id,
      date: moment(),
      reason: e.message
    });

  });
  this.order.on('completed', () => {
    this.order.createSummary((err, summary) => {
      if(!err && !summary) {
        err = new Error('GB returned an empty summary.')
      }

      if(err) {
        log.error('Error while creating summary:', err);
        return this.deferredEmit('tradeErrored', {
          id,
          adviceId: advice.id,
          date: moment(),
          reason: err.message
        });
      }

      log.info('[ORDER] summary:', summary);
      this.order = null;
      this.activeDirection = null;
      this.sync(() => {

        let cost;
        if(_.isNumber(summary.feePercent)) {
          cost = summary.feePercent / 100 * summary.amount * summary.price;
        }

        let effectivePrice;
        if(_.isNumber(summary.feePercent)) {
          if(side === 'buy') {
            effectivePrice = summary.price * (1 + summary.feePercent / 100);
          } else {
            effectivePrice = summary.price * (1 - summary.feePercent / 100);
          }
        } else {
          log.warn('WARNING: exchange did not provide fee information, assuming no fees..');
          effectivePrice = summary.price;
        }

        this.deferredEmit('tradeCompleted', {
          id,
          adviceId: advice.id,
          action: summary.side,
          cost,
          amount: summary.amount,
          price: summary.price,
          portfolio: this.portfolio,
          balance: this.balance,
          date: summary.date,
          feePercent: summary.feePercent,
          effectivePrice
        });

        this.recoverOrCreateTriggers(advice, summary.price);

        log.info(`Portfolio after last trade ${this.portfolio}`);
        // Callback here is the following advice process for close_then_sell and close_then_buy.
        if (!!cb) {
          cb();
        }
      });
    });
  });
};

Trader.prototype.onFixedStopTrigger = function(initialPrice, stopPrice) {
  log.info(`TrailingStop trigger "${this.activeStopTrigger.trailingStopTrigger.id}" fired! 
            Initial price is ${initialPrice}, Triggered stop price is ${stopPrice}`);

  if (!!this.activeStopTrigger && !!this.activeStopTrigger.fixedStopTrigger) {
    this.deferredEmit('triggerFired', {
      id: this.activeStopTrigger.fixedStopTrigger.id,
      date: moment()
    });

    const adviceMock = {
      recommendation: 'close',
      id: this.activeStopTrigger.fixedStopTrigger.adviceId
    };

    delete this.activeStopTrigger.fixedStopTrigger;

    this.processAdvice(adviceMock);
  }
};

Trader.prototype.onTrailingStopTrigger = function(price) {
  log.info(`TrailingStop trigger "${this.activeStopTrigger.trailingStopTrigger.id}" fired! 
            Observed price was ${price}`);

  if (!!this.activeStopTrigger && !!this.activeStopTrigger.trailingStopTrigger) {
    this.deferredEmit('triggerFired', {
      id: this.activeStopTrigger.trailingStopTrigger.id,
      date: moment()
    });

    const adviceMock = {
      recommendation: 'close',
      id: this.activeStopTrigger.trailingStopTrigger.adviceId
    };

    delete this.activeStopTrigger.trailingStopTrigger;

    this.processAdvice(adviceMock);
  }
};

Trader.prototype.cancelOrder = function(id, advice, next) {

  if(!this.order) {
    return next();
  }

  this.cancellingOrder = true;

  this.order.removeAllListeners();
  this.order.cancel();
  this.order.once('completed', () => {
    this.order = null;
    this.activeDirection = null;
    this.cancellingOrder = false;
    this.deferredEmit('tradeCancelled', {
      id,
      adviceId: advice.id,
      date: moment()
    });
    this.sync(next);
  });
};

module.exports = Trader;
