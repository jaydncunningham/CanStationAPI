
const { postURL } = require('./utils');
setInterval(() => postURL('http://localhost:5000/canstation-46066/us-central1/api/gas-estimate').then(body => console.log(body)), 10 * 1000);