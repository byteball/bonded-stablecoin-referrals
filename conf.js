/*jslint node: true */
"use strict";
exports.port = null;
//exports.myUrl = 'wss://mydomain.com/bb';
exports.bServeAsHub = false;
exports.bLight = false;

exports.storage = 'sqlite';

// TOR is recommended. Uncomment the next two lines to enable it
exports.socksHost = '127.0.0.1';
exports.socksPort = 9050;

exports.hub = process.env.testnet ? 'obyte.org/bb-test' : 'obyte.org/bb';
exports.deviceName = 'Stablecoin referrals';
exports.permanent_pairing_secret = '*'; // * allows to pair with any code, the code is passed as 2nd param to the pairing event handler
exports.control_addresses = [''];
exports.payout_address = 'WHERE THE MONEY CAN BE SENT TO';

exports.bIgnoreUnpairRequests = true;
exports.bSingleAddress = true;
exports.KEYS_FILENAME = 'keys.json';

// smtp https://github.com/byteball/ocore/blob/master/mail.js
exports.smtpTransport = 'local'; // use 'local' for Unix Sendmail
exports.smtpRelay = '';
exports.smtpUser = '';
exports.smtpPassword = '';
exports.smtpSsl = null;
exports.smtpPort = null;

// emails
exports.admin_email = '';
exports.from_email = '';


exports.curve_base_aas = ['FCFYMFIOGS363RLDLEWIDBIIBU7M7BHP', '3RNNDX57C36E76JLG2KAQSIASAYVGAYG'];
exports.deposit_base_aa = 'GEZGVY4T3LK6N4NJAKNHNQIVAI5OYHPC';
exports.t1_arb_base_aa = '7DTJZNB3MHSBVI72CKXRIKONJYBV7I2Z';
exports.interest_arb_base_aa = 'WURQLCAXAX3WCVCFYJ3A2PQU4ZB3ALG7';
exports.oswap_factory_aa = 'B22543LKSS35Z55ROU4GDN26RT6MDKWU';

exports.liquidity_mining_aa = '7AUBFK4YAUGUF3RWWYRFXXF7BBWY2V7Y';
exports.bank_aa = 'GV5YXIIRH3DH5FTEECW7IS2EQTAYJJ6S';
exports.odex_aa = 'FVRZTCFXIDQ3EYRGQSLE5AMWUQF4PRYJ';

exports.iusd_curve_aa = process.env.testnet ? '7FSSFG2Y5QHQTKVRFB3VWL6UNX3WB36O' : '26XAPPPTTYRIOSYNCUV3NS2H57X5LZLJ';
exports.iusd_asset = process.env.testnet ? 'y6rgKvNV6CD1fa4PkfB28rSuje1l+DS70XWXBCzaSm4=' : '9V8nZuKfa8T3Hr1+40SXkkPeCS6w1+xkRFg4iqk9hws=';

exports.assets_data_url = process.env.testnet ? "https://testnet-data.ostable.org/api/v1/assets" : "https://data.ostable.org/api/v1/assets";

exports.daysBetweenDistributions = 7;

exports.referrerReward = 0.1;
exports.referredReward = 0.05;

exports.max_total_reward = 3000; // USD

exports.max_fee = 1; // in %

exports.webPort = 3000;
