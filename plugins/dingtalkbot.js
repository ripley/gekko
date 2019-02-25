const log = require('../core/log');
const moment = require('moment');
const _ = require('lodash');
const config = require('../core/util').getConfig();
const dingtalkbotconf = config.dingtalkbot;
const emitTrades = dingtalkbotconf.emitTrades;
const utc = moment.utc;
const dingtalkbot = require("dingtalk-robot-sender");

const Actor = function() {
  _.bindAll(this);

  this.advice = null;
  this.adviceTime = utc();

  this.price = 'Dunno yet :(';
  this.priceTime = utc();

  this.bot = new dingtalkbot({
    baseUrl: 'https://oapi.dingtalk.com/robot/send',
    accessToken: dingtalkbotconf.token,
  });
};

Actor.prototype.sendMessage = function(msg) {
  let extendedMsg = `Message from account ${dingtalkbotconf.accountName}\n${msg}`;
  let textContent = {
    msgtype: "text",
    text: {
      "content": extendedMsg
    },
  };
  this.bot
    .send(textContent)
    .catch((err) => {
        log.error('DingTalk ERROR:', err);
    });
};

Actor.prototype.processCandle = function(candle, done) {
  this.price = candle.close;
  this.priceTime = candle.start;

  done();
};

Actor.prototype.processAdvice = function(advice) {
  this.advice = advice.recommendation;
  this.adviceTime = utc();
  this.advicePrice = this.price;
  this.emitAdvice();
};

if(emitTrades) {
  Actor.prototype.processTradeInitiated = function (tradeInitiated) {
    let message = 'Trade initiated. ID: ' + tradeInitiated.id +
    '\nAction: ' + tradeInitiated.action + '\nPortfolio: ' +
    JSON.stringify(tradeInitiated.portfolio, null, 2) + '\nBalance: ' + tradeInitiated.balance;
    this.sendMessage(message);
  };
  
  Actor.prototype.processTradeCancelled = function (tradeCancelled) {
    let message = 'Trade cancelled. ID: ' + tradeCancelled.id;
    this.sendMessage(message);
  };
  
  Actor.prototype.processTradeAborted = function (tradeAborted) {
    let message = 'Trade aborted. ID: ' + tradeAborted.id +
    '\nNot creating order! Reason: ' + tradeAborted.reason;
    this.sendMessage(message);
  };
  
  Actor.prototype.processTradeErrored = function (tradeErrored) {
    let message = 'Trade errored. ID: ' + tradeErrored.id +
    '\nReason: ' + tradeErrored.reason;
    this.sendMessage(message);
  };
  
  Actor.prototype.processTradeCompleted = function (tradeCompleted) {
    let message = 'Trade completed. ID: ' + tradeCompleted.id +
    '\nAction: ' + tradeCompleted.action +
    '\nPrice: ' + tradeCompleted.price +
    '\nAmount: ' + tradeCompleted.amount +
    '\nCost: ' + tradeCompleted.cost +
    '\nPortfolio: ' + JSON.stringify(tradeCompleted.portfolio, null, 2) +
    '\nBalance: ' + tradeCompleted.balance +
    '\nFee percent: ' + tradeCompleted.feePercent +
    '\nEffective price: ' + tradeCompleted.effectivePrice;
    this.sendMessage(message);
  }
}

Actor.prototype.emitStart = function() {
  this.sendMessage('Gekko Margin Started!');
};

Actor.prototype.emitAdvice = function() {
  let message = [
    'Advice for ',
    config.watch.exchange,
    ' ',
    config.watch.currency,
    '/',
    config.watch.asset,
    ' using ',
    config.tradingAdvisor.method,
    ' at ',
    config.tradingAdvisor.candleSize,
    ' minute candles, is:\n',
  ].join('');
  if (this.advice) {
    message += this.advice +
      ' ' +
      config.watch.asset +
      ' ' +
      this.advicePrice +
      ' (' +
      this.adviceTime.fromNow() +
      ')';
  } else {
    message += 'None'
  }

  this.sendMessage(message);
};

// sent price over to the last chat
Actor.prototype.emitPrice = function() {
  const message = [
    'Current price at ',
    config.watch.exchange,
    ' ',
    config.watch.currency,
    '/',
    config.watch.asset,
    ' is ',
    this.price,
    ' ',
    config.watch.currency,
    ' (from ',
    this.priceTime.fromNow(),
    ')'
  ].join('');

  this.sendMessage(message);
};

Actor.prototype.logError = function(message) {
  log.error('Telegram ERROR:', message);
};

module.exports = Actor;
