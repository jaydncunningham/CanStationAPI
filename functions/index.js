// libs
const app = require('express')();
const cors = require('cors');
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { getURL, formatNum } = require('./utils');
const ethGasStationURL = {
  gasEstimates: 'https://ethgasstation.info/json/ethgasAPI.json'
}

// Firebase supports Node 6.11.5 which doesn't has Object.values 
const getObjectValues = obj => obj ? Object.keys(obj).map(prop => obj[prop]) : [];
Object.values = Object.values || getObjectValues;

//init
admin.initializeApp();

const corsOptions = {
  origin: [/localhost/, /canyagasstation/, /canstation/, /canstation.canya\.[com|io]+/]
};

app.use(cors(corsOptions));

// vars
const gasEstimatesRef = admin.database().ref('/gas-estimates');

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
  getURL(ethGasStationURL.gasEstimates).then(body => {
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
  // estimates stored every 1 minute and each estimate creates 4 records
  // 240 records represents last 1 hour estimates (1h * 60m * 4records = 240)  
  gasEstimatesRef.limitToLast(240).once("value", snapshot => {
    const estimates = Object.values(snapshot.val());
    const groupedEstimates = groupEstimates(estimates);
    const avgEstimates = calcGroupedEstimatesAvg(groupedEstimates);

    return res.status(200).json(avgEstimates);
  });
});

app.get('/gas-estimate', (req, res) => {
  // estimates stored every 1 minute and each estimate creates 4 records
  // 240 records represents last 60 minute estimates (60m * 4records = 240)
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
      costPerGwei: Number(estimateObject.fastest) / 10,
      waitTimeInMin: estimateObject.fastestWait,
      blockNum: estimateObject.blockNum,
      createdAt: Date.now(),
    },
    {
      type: 'Fast',
      costPerGwei: Number(estimateObject.fast) / 10,
      waitTimeInMin: estimateObject.fastWait,
      blockNum: estimateObject.blockNum,
      createdAt: Date.now()
    },
    {
      type: 'Standard',
      costPerGwei: Number(estimateObject.average) / 10,
      waitTimeInMin: estimateObject.avgWait,
      blockNum: estimateObject.blockNum,
      createdAt: Date.now(),
    },
    {
      type: 'Safelow',
      costPerGwei: Number(estimateObject.safeLow) / 10,
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

exports.api = functions.https.onRequest(app);