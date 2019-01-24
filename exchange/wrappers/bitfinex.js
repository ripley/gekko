
const Bitfinex = require("bitfinex-api-node");
const _ = require('lodash');
const moment = require('moment');

const Errors = require('../exchangeErrors');
const retry = require('../exchangeUtils').retry;

const marketData = require('./bitfinex-markets.json');

var Trader = function(config) {
  _.bindAll(this);
  if(_.isObject(config)) {
    this.key = config.key;
    this.secret = config.secret;
  }
  this.name = 'Bitfinex';
  this.balance;
  this.price;
  this.asset = config.asset;
  this.assets = config.assets;
  this.currency = config.currency;
  this.pair = this.asset + this.currency;
  this.bitfinex = new Bitfinex.RESTv1({apiKey: this.key, apiSecret: this.secret, transform: true});

  this.interval = 4000;
}

const includes = (str, list) => {
  if(!_.isString(str))
    return false;

  return _.some(list, item => str.includes(item));
}

const recoverableErrors = [
  'SOCKETTIMEDOUT',
  'ESOCKETTIMEDOUT',
  'TIMEDOUT',
  'CONNRESET',
  'CONNREFUSED',
  'NOTFOUND',
  '443',
  '504',
  '503',
  '502',
  'Empty response',
  'Nonce is too small'
];

Trader.prototype.handleResponse = function(funcName, callback) {
  return (error, data) => {

    // Only check if error is undefined, it's is OK if data === [] since it
    // is what returned when there's no position in trading wallet.

    // if(!error && _.isEmpty(data)) {
    //   error = new Error('Empty response');
    // }

    if(error) {
      const message = error.message;

      console.log('handleResponse', funcName, message);

      // in case we just cancelled our balances might not have
      // settled yet, retry.
      if(
        funcName === 'submitOrder' &&
        message.includes('not enough exchange balance')
      ) {
        error.retry = 20;
        return callback(error);
      }

      // most likely problem with v1 api
      if(
        funcName === 'submitOrder' &&
        message.includes('Cannot evaluate your available balance, please try again')
      ) {
        error.retry = 10;
        return callback(error);
      }

      // in some situations bfx returns 404 on
      // orders created recently
      if(
        funcName === 'checkOrder' &&
        message.includes('Not Found')
      ) {
        error.retry = 5;
        return callback(error);
      }

      if(includes(message, recoverableErrors)) {
        error.notFatal = true;
        return callback(error);
      }

      if(includes(message, 'Too Many Requests')) {
        error.notFatal = true;
        error.backoffDelay = 5000;
      }
    }

    return callback(error, data);
  }
};

Trader.prototype.getPortfolio = function(callback) {
  const processWalletBalance = (err, data) => {
    if (err) return callback(err);

    // We are only interested in funds in the "trading" wallet for margin trading
    data = data.filter(c => c.type === 'trading');

    // Get assets
    const assets = _.filter(data, c => this.assets.includes(c.currency.toUpperCase()));
    let assetsData = [];
    assets.forEach(data => {
      let assetAmount;
      if(_.isObject(data) && _.isNumber(+data.available) && !_.isNaN(+data.available))
        assetAmount = +data.available;
      else {
        assetAmount = 0;
      }

      assetsData.push({ name: data.currency.toUpperCase(), amount: assetAmount});
    });

    // Get currency
    const currency = _.find(data, c => c.currency.toUpperCase() === this.currency);
    let currencyFree, currencyUsed, currencyTotal;

    if(_.isObject(currency) && _.isNumber(+currency.available) && !_.isNaN(+currency.available)) {
      currencyFree = +currency.available;
      currencyTotal = +currency.amount;
      currencyUsed = currencyTotal - currencyFree;
    }
    else {
      currencyFree = 0;
    }

    let processPositions = (err, operations) => {
      if(err) return callback(err);
      if(!operations) {
        log.error("got undefined operations list", err);
        return callback()
      }

      assetsData = assetsData.map(data => {
        operations.forEach((operation) => {
          if(operation.symbol.toUpperCase().substr(0,3) === data.name) {
            data.amount += parseFloat(operation.amount);
            data.base = operation.base;
            data.timestamp = operation.timestamp;
          }
        });

        return {name: data.name, amount: data.amount, base: data.base, timestamp: data.timestamp};
      });

      const portfolio = [
        { name: this.currency, used: currencyUsed, free: currencyFree, total: currencyTotal},
        ...assetsData
      ];

      callback(undefined, portfolio);
    };
    const fetch = cb => this.bitfinex.active_positions(this.handleResponse('getPortfolio', cb));
    retry(null, fetch, processPositions);
  };

  const fetch = cb => this.bitfinex.wallet_balances(this.handleResponse('getPortfolio', cb));
  retry(null, fetch, processWalletBalance);
};

Trader.prototype.getTicker = function(callback) {
  const processResponse = (err, data) => {
    if (err)
      return callback(err);

    callback(undefined, {bid: +data.bid, ask: +data.ask});
  };

  const fetch = cb => this.bitfinex.ticker(this.pair, this.handleResponse('getTicker', cb));
  retry(null, fetch, processResponse);
}

Trader.prototype.getFee = function(callback) {
  const makerFee = 0.1;
  // const takerFee = 0.2;
  callback(undefined, makerFee / 100);
}

Trader.prototype.roundAmount = function(amount) {
  return Math.floor(amount*100000000)/100000000;
}

Trader.prototype.roundPrice = function(price) {
  // todo: calc significant digits
  return price;
}

Trader.prototype.submitOrder = function(type, amount, price, callback) {
  const processResponse = (err, data) => {
    if (err)
      return callback(err);

    callback(null, data.order_id);
  }

  const fetch = cb => this.bitfinex.new_order(this.pair,
    amount + '',
    price + '',
    this.name.toLowerCase(),
    type,
    'limit',
    'limit',
    this.handleResponse('submitOrder', cb)
  );

  retry(null, fetch, processResponse);
}

Trader.prototype.buy = function(amount, price, callback) {
  this.submitOrder('buy', amount, price, callback);
}

Trader.prototype.sell = function(amount, price, callback) {
  this.submitOrder('sell', amount, price, callback);
}

Trader.prototype.checkOrder = function(order_id, callback) {
  const processResponse = (err, data) => {
    if (err) {
      console.log('this is after we have retried fetching it');
      // this is after we have retried fetching it
      // in this.handleResponse.
      if(err.message.includes('Not Found')) {
        return callback(undefined, {
          open: false,
          executed: true
        });
      }

      return callback(err);
    }

    return callback(undefined, {
      open: data.is_live,
      executed: data.original_amount === data.executed_amount,
      filledAmount: +data.executed_amount
    });
  }

  const fetcher = cb => this.bitfinex.order_status(order_id, this.handleResponse('checkOrder', cb));
  retry(null, fetcher, processResponse);
}


Trader.prototype.getOrder = function(order_id, callback) {
  const processResponse = (err, data) => {
    if (err) return callback(err);

    var price = parseFloat(data.avg_execution_price);
    var amount = parseFloat(data.executed_amount);
    var date = moment.unix(data.timestamp);

    console.log('getOrder', data);

    // TEMP: Thu May 31 14:49:34 CEST 2018
    // the `past_trades` call is not returning
    // any data.
    return callback(undefined, {price, amount, date});

    const processPastTrade = (err, data) => {
      if (err) return callback(err);

      console.log('processPastTrade', data);
      const trade = _.first(data);

      const fees = {
        [trade.fee_currency]: trade.fee_amount
      }

      callback(undefined, {price, amount, date, fees});
    }

    // we need another API call to fetch the fees
    const feeFetcher = cb => this.bitfinex.past_trades(this.currency, {since: data.timestamp}, this.handleResponse('pastTrades', cb));
    retry(null, feeFetcher, processPastTrade);

    callback(undefined, {price, amount, date});
  };

  const fetcher = cb => this.bitfinex.order_status(order_id, this.handleResponse('getOrder', cb));
  retry(null, fetcher, processResponse);
}


Trader.prototype.cancelOrder = function(order_id, callback) {
  const processResponse = (err, data) => {
    if (err) {
      return callback(err);
    }

    return callback(undefined, false);
  }

  const handler = cb => this.bitfinex.cancel_order(order_id, this.handleResponse('cancelOrder', cb));
  retry(null, handler, processResponse);
}

Trader.prototype.getTrades = function(since, callback, descending) {
  const processResponse = (err, data) => {  
    if (err) return callback(err);

    var trades = _.map(data, function(trade) {
      return {
        tid: trade.tid, 
        date:  trade.timestamp, 
        price: +trade.price, 
        amount: +trade.amount
      }
    });

    callback(undefined, descending ? trades : trades.reverse());
  };

  var path = this.pair; 
  if(since) 
    path += '?limit_trades=2000'; 

  const handler = cb => this.bitfinex.trades(path, this.handleResponse('getTrades', cb));
  retry(null, handler, processResponse);
}

Trader.getCapabilities = function () {
  return {
    name: 'Bitfinex',
    slug: 'bitfinex',
    currencies: marketData.currencies,
    assets: marketData.assets,
    markets: marketData.markets,
    requires: ['key', 'secret'],
    tid: 'tid',
    providesFullHistory: true,
    providesHistory: 'date',
    tradable: true,
    forceReorderDelay: true,
    gekkoBroker: 0.6
  };
}

module.exports = Trader;
