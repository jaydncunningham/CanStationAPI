const functions = require('firebase-functions');

// libs
const app = require('express')();
const request = require('request');
const admin = require('firebase-admin');
admin.initializeApp();

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
      formatEthGasInfoEstimatesToArray(body).forEach(gasEstimatesRef.push);

      // don't need to wait for the db insertion results
      return res.sendStatus(200);
    })
    .catch(err => res.status('400').json(err));
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
      type: 'fastest',
      costPerGwei: Number(estimateObject.fastest) / Number(estimateObject.average_calc),
      waitTimeInMin: estimateObject.fastestWait,
      blockNum: estimateObject.blockNum,
      createdAt: Date.now(),
    },
    {
      type: 'fast',
      costPerGwei: Number(estimateObject.fast) / Number(estimateObject.average_calc),
      waitTimeInMin: estimateObject.fastWait,
      blockNum: estimateObject.blockNum,
      createdAt: Date.now()
    },
    {
      type: 'standard',
      costPerGwei: Number(estimateObject.average) / Number(estimateObject.average_calc),
      waitTimeInMin: estimateObject.avgWait,
      blockNum: estimateObject.blockNum,
      createdAt: Date.now(),
    },
    {
      type: 'safelow',
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
    groupedEstimates[est.type] = groupedEstimates[est.type] || emptyGroupedEstimate;
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
    let avgCostPerGwei = parseFloat(estType.totalCostPerGwei / estType.numRecords).toFixed(3);
    let avgWaitTimeInMin = parseFloat(estType.totalWaitTimeInMin / estType.numRecords).toFixed(3);
    Object.assign(estType, {
      avgCostPerGwei,
      avgWaitTimeInMin
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

exports.api = functions.https.onRequest(app);
