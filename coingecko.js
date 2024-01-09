/*jslint node: true */
"use strict";
const fetch = require('node-fetch');

const URL = 'https://api.coingecko.com';


const request = (endpoint, options) => {
	return fetch(`${URL}${endpoint}`, {
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
		},
		...options
	})
}

const fetchExchangeRate = async () => {
	const response = await request(`/api/v3/simple/price?ids=byteball&vs_currencies=usd`)

//	console.error(JSON.stringify(response, null, 2))
//	console.error('ok', response.ok)

	if (!response.ok) {
		const error = await response.text()
		console.error('-- error', error)
		throw new Error(error)
	}

	const data = await response.json()
	if (!data.byteball || !data.byteball.usd)
		throw new Error(`no usd in CG response ${JSON.stringify(data)}`);
	return data.byteball.usd
}


exports.fetchExchangeRate = fetchExchangeRate;
