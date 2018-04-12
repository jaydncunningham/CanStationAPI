
const { postURL } = require('./utils');
setInterval(() => postURL('http://localhost:5000/canyagasstation-a98a8/us-central1/api/gas-estimate').then(body => console.log(body)), 10 * 1000);