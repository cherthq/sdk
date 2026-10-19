const axios = require('axios');

exports.send = (contact, text) => axios.post('https://a.loopmessage.com/api/v1/message/send/', { contact, text, channel: 'imessage' }, {
  headers: { Authorization: process.env.LOOPMESSAGE_AUTH_KEY },
});
exports.status = id => axios.get(`https://a.loopmessage.com/api/v1/message/status/${id}/`);
exports.legacy = body => axios.post('https://server.loopmessage.com/api/v1/message/send/', body);
