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

let finalData = [];

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
  let md = '';
  dataObjs.forEach(obj => {
    md = md + `## ${obj.account}:\n`;
    if (!!obj.data && obj.data.length > 0) {
      obj.data.forEach(entry => {
        md = md + `### Symbol: ${entry.symbol}\n\n > 状态: ${entry.status} \n\n > 基价: ${entry.base} \n\n > 仓位: ${entry.amount} \n\n > 时间: ${(new Date(entry.timestamp * 1000)).toLocaleString()} \n\n > 未实现盈亏: ${entry.pl} \n\n\n\n`;
      })
    } else {
      md = md + '> 空仓\n\n';
    }
  });

  return md;
}

function createCb(account) {
  return (err, data) => {
    finalData.push({account: account, data: data});
    if (finalData.length === credentials.length) {
      // All data received, go ahead to send to dingtalk.
      //sendJsonMessage(JSON.stringify(finalData, null, 2));
      sendMdMessage(convertJsonToMd(finalData))
      // console.log(JSON.stringify(finalData, null, 2));
    }
  };
}

function run() {
  finalData = [];
  credentials.forEach(credential => {
    let bfx = new BFX.RESTv1({
      apiKey: credential.key,
      apiSecret: credential.secret,
      transform: true
    });
    bfx.active_positions(createCb(credential.name));
  });
}

// run();
setInterval(run, 1800000);
