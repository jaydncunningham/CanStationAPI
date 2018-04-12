const request = require('request');

// @Desc: Performs GET operation for a given URL and returns a promise
// @Input: URL
// @Output: Promise to be rejected with err or resolved with the response body
const postURL = (url, body) => {
  return new Promise((resolve, reject) => {
    request({
      url,
      json: true,
      method: 'POST',
      body: body
    }, (err, response, body) => {
      if (err) {
        console.log('Err: ', err);
        return reject(err);
      }

      if (response && response.statusCode !== 200) {
        console.log('Invalid statusCode: ', response.statusCode);
        return reject(new Error('Invalid status code: ' + response.statusCode));
      }

      return resolve(body);
    });
  });
};

// @Desc: Performs GET operation for a given URL and returns a promise
// @Input: URL
// @Output: Promise to be rejected with err or resolved with the response body
const getURL = (url) => {
  return new Promise((resolve, reject) => {
    request.get(url, {
      json: true
    }, (err, response, body) => {
      if (err) {
        console.log('Err: ', err);
        return reject(err);
      }

      if (response && response.statusCode !== 200) {
        console.log('Invalid statusCode: ', response.statusCode);
        return reject(new Error('Invalid status code: ' + response.statusCode));
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

module.exports = {
  formatNum,
  postURL,
  getURL
}
