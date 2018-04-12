// libs
const app = require('express')();
const cors = require('cors');
const request = require('request');
const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Firebase supports Node 6.11.5 which doesn't has Object.values 
const getObjectValues = obj => Object.keys(obj).map(prop => obj[prop]);
Object.values = Object.values || getObjectValues;

//init
admin.initializeApp();

const corsOptions = {
  origin: [/localhost/, /canyagasstation/, /gasstation.canya\.[com|io]+/]
};

app.use(cors(corsOptions));

// vars
const gasEstimatesRef = admin.database().ref('/gas-estimates');
const ethGasStationURL = {
  gasEstimates: 'https://ethgasstation.info/json/ethgasAPI.json'
}

/**
Sample response from ethgasstation:
https://ethgasstation.info/json/ethgasAPI.json
{
  "fastWait": 0.5,
  "average": 10.0,
  "blockNum": 5406970,
  "safelow_calc": 10.0,
  "fast": 10.0,
  "fastest": 40.0,
  "safeLow": 10.0,
  "safelow_txpool": 10.0,
  "safeLowWait": 0.5,
  "block_time": 14.331632653061224,
  "average_txpool": 10.0,
  "avgWait": 0.5,
  "speed": 0.6928822020416516,
  "fastestWait": 0.5,
  "average_calc": 10.0
}
*/
app.post('/gas-estimate', (req, res) => {
  getURL().then(body => {
      // Format & push formated estimates to the firebase store
      formatEthGasInfoEstimatesToArray(body).forEach(item => gasEstimatesRef.push(item));

      // don't need to wait for the db insertion results
      return res.sendStatus(200);
    })
    .catch(err => {
      console.log('posting gas-estimate error: ', err);
      res.status('400').json(err);
    });
});

app.get('/gas-estimate/average', (req, res) => {
  gasEstimatesRef.limitToLast(100).once("value", snapshot => {
    const estimates = Object.values(snapshot.val());
    const groupedEstimates = groupEstimates(estimates);
    const avgEstimates = calcGroupedEstimatesAvg(groupedEstimates);

    return res.status(200).json(avgEstimates);
  });
});

app.get('/gas-estimate', (req, res) => {
  // estimates stored every 1 minute and each estimate creates 4 records
  // 240 records represents last 60 minute estimates (60 * 4 = 240)
  gasEstimatesRef.limitToLast(240).once("value", snapshot => {
    const estimates = Object.values(snapshot.val());
    return res.status(200).json(estimates);
  });
});

// @Desc: Convert ethgasstation results object into list of estimates
// @Input: Object represents ethgasstation estimates
// @Output: List of estimates where each estimate has properties (type, costPerGwei, waitTImeInMin, blockNum, createdAt)
const formatEthGasInfoEstimatesToArray = (estimateObject) => {
  return [{
      type: 'Fastest',
      costPerGwei: Number(estimateObject.fastest) / Number(estimateObject.average_calc),
      waitTimeInMin: estimateObject.fastestWait,
      blockNum: estimateObject.blockNum,
      createdAt: Date.now(),
    },
    {
      type: 'Fast',
      costPerGwei: Number(estimateObject.fast) / Number(estimateObject.average_calc),
      waitTimeInMin: estimateObject.fastWait,
      blockNum: estimateObject.blockNum,
      createdAt: Date.now()
    },
    {
      type: 'Standard',
      costPerGwei: Number(estimateObject.average) / Number(estimateObject.average_calc),
      waitTimeInMin: estimateObject.avgWait,
      blockNum: estimateObject.blockNum,
      createdAt: Date.now(),
    },
    {
      type: 'Safelow',
      costPerGwei: Number(estimateObject.safeLow) / Number(estimateObject.safelow_calc),
      waitTimeInMin: estimateObject.safeLowWait,
      blockNum: estimateObject.blockNum,
      createdAt: Date.now(),
    }
  ];
}

// @Desc: Groups list of estimates per type
// @Input: List of estimates
// @Output: Grouped estimate object by type where each type has properties (totalCostPerGwei, totalWaitTimeInMin, numRecords)
const groupEstimates = (pEstimates) => {
  const estimates = Object.assign({}, pEstimates);
  const groupedEstimates = {};
  const emptyGroupedEstimate = {
    totalCostPerGwei: 0,
    totalWaitTimeInMin: 0,
    numRecords: 0
  };

  Object.values(estimates).forEach(est => {
    groupedEstimates[est.type] = groupedEstimates[est.type] || Object.assign({}, emptyGroupedEstimate);
    groupedEstimates[est.type].totalCostPerGwei += est.costPerGwei;
    groupedEstimates[est.type].totalWaitTimeInMin += est.waitTimeInMin;
    groupedEstimates[est.type].numRecords += 1
  });

  return groupedEstimates;
}

// @Desc: Calc the average of totalCostPerGwei & totalWaitTimeInMin
// @Input: Grouped estimate object
// @Output: New grouped estimates object with extra 2 properties (avgCostPerGwei & avgWaitTimeInMin)
const calcGroupedEstimatesAvg = (gEstimates) => {
  const groupedEstimates = Object.assign({}, gEstimates);
  Object.keys(groupedEstimates).forEach(key => {
    let estType = groupedEstimates[key];
    let avgCostPerGwei = formatNum(estType.totalCostPerGwei / estType.numRecords, 6);
    let avgWaitTimeInMin = formatNum(estType.totalWaitTimeInMin / estType.numRecords, 6);
    groupedEstimates[key] = Object.assign({}, estType, {
      avgCostPerGwei,
      avgWaitTimeInMin,
      label: key + ' < ' + Math.ceil(avgWaitTimeInMin) + 'm',
      type: key
    });
  });
  return groupedEstimates;
}

// @Desc: Performs GET operation for a given URL and returns a promise
// @Input: URL
// @Output: Promise to be rejected with err or resolved with the response body
const getURL = (url) => {
  return new Promise((resolve, reject) => {
    request.get(ethGasStationURL.gasEstimates, {
      json: true
    }, (err, response, body) => {
      if (err || response.statusCode !== 200) {
        console.log('err: ', err, ' with statusCode: ', response.statusCode);
        return reject(err);
      }

      return resolve(body);
    });
  });
};

// @Desc: Format a given number to a fixed decimal digits but removes the last 0s from the decimal part
// @Input: Number and decimals digits required to be fixed
// @Output: Return formatted number. Ex: 10 => 10 | 10.500 => 10.5 | 10.50500 => 10.505
const formatNum = (number, decimals) => {
  const num = parseFloat(number).toFixed(decimals).split('.');
  const decimalsStr = num[1];

  if (Number(decimalsStr) > 0) {

    let last0Pos = 0;
    for (let i = decimalsStr.length - 1; i >= 0; i--) {
      if (decimalsStr[i] !== '0') {
        last0Pos = i;
        break;
      }
    }

    return num[0] + '.' + decimalsStr.substr(0, last0Pos + 1);
  }

  return num[0];
}

exports.api = functions.https.onRequest(app);
