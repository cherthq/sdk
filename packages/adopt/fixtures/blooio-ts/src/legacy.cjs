const Blooio = require('@blooio/sdk');

const client = new Blooio({});
module.exports = () => client.messages.cancel('m1');
