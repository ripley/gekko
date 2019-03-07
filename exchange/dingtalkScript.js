const BFX = require("bitfinex-api-node");
const DINGBOT = require("dingtalk-robot-sender");
const fs = require('fs');

let contents = fs.readFileSync('reportConf.json', 'utf8');
let reportConf = JSON.parse(contents);

if (!reportConf.dingbotToken || !reportConf.credentials) {
  console.log(`Didn't get mandatory argument parsed, exiting ...`);
  process.exit(2);
}

const credentials = reportConf.credentials;

const bot = new DINGBOT({
  baseUrl: 'https://oapi.dingtalk.com/robot/send',
  accessToken: reportConf.dingbotToken
});

let finalData = {
  portfolio: [],
  orders: []
};

function sendJsonMessage(extendedMsg) {
  let textContent = {
    msgtype: "text",
    text: {
      "content": extendedMsg
    },
  };
  bot.send(textContent).catch((err) => {
      log.error('DingTalk ERROR:', err);
    });
}

function sendMdMessage(extendedMsg) {
  let textContent = {
    msgtype: "markdown",
    markdown: {
      "title": '账户信息汇总',
      "text": extendedMsg
    },
  };
  bot.send(textContent).catch((err) => {
    log.error('DingTalk ERROR:', err);
  });
}

function convertJsonToMd(dataObjs) {
  let md = '# Portfolio概要: \n';
  dataObjs.portfolio.forEach(obj => {
    md = md + `## ${obj.account}:\n`;
    if (!!obj.data && obj.data.length > 0) {
      obj.data.forEach(entry => {
        md = md + `### Symbol: ${entry.symbol}\n\n > 状态: ${entry.status} \n\n > 基价: ${entry.base} \n\n > 仓位: ${entry.amount} \n\n > 时间: ${(new Date(entry.timestamp * 1000)).toLocaleString()} \n\n > 未实现盈亏: ${entry.pl} \n\n\n\n`;
      })
    } else {
      md = md + '> 空仓\n\n';
    }
  });

  md = md + '# Orders概要: \n';
  dataObjs.orders.forEach(obj => {
    md = md + `## ${obj.account}:\n`;
    if (!!obj.data && obj.data.length > 0) {
      obj.data.forEach(entry => {
        md = md + `### Symbol: ${entry.symbol}\n\n > 类型: ${entry.type} \n\n > 出价: ${entry.price} \n\n > 挂单量: ${entry.original_amount} \n\n > 已成交: ${entry.executed_amount} \n\n > 待成交: ${entry.remaining_amount} \n\n > 时间: ${(new Date(entry.timestamp * 1000)).toLocaleString()} \n\n > 未实现盈亏: ${entry.pl} \n\n\n\n`;
      })
    } else {
      md = md + '> 当前无活动挂单\n\n';
    }
  });

  return md;
}

function createCbForPortfolio(account) {
  return (err, data) => {
    finalData.portfolio.push({account: account, data: data, err:err});
    if (finalData.portfolio.length === credentials.length
      && finalData.orders.length === credentials.length) {
      // All data received, go ahead to send to dingtalk.
      //sendJsonMessage(JSON.stringify(finalData, null, 2));
      sendMdMessage(convertJsonToMd(finalData))
      // console.log(JSON.stringify(finalData, null, 2));
    }
  };
}

function createCbForOrders(account) {
  return (err, data) => {
    finalData.orders.push({account: account, data: data, err:err});
    if (finalData.portfolio.length === credentials.length
      && finalData.orders.length === credentials.length) {
      // All data received, go ahead to send to dingtalk.
      //sendJsonMessage(JSON.stringify(finalData, null, 2));
      sendMdMessage(convertJsonToMd(finalData))
      // console.log(JSON.stringify(finalData, null, 2));
    }
  };
}


function run() {
  finalData = {
    portfolio: [],
    orders: []
  };
  credentials.forEach(credential => {
    let bfx = new BFX.RESTv1({
      apiKey: credential.key,
      apiSecret: credential.secret,
      transform: true
    });
    bfx.active_positions(createCbForPortfolio(credential.name));
    setTimeout(() => {bfx.active_orders(createCbForOrders(credential.name))}, 5000);
  });
}

// run();
setInterval(run, 1800000);
