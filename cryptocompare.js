/*jslint node: true */
"use strict";
const fetch = require('node-fetch');

const URL = 'https://min-api.cryptocompare.com';


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
	const response = await request(`/data/price?fsym=GBYTE&tsyms=USD`)

//	console.error(JSON.stringify(response, null, 2))
//	console.error('ok', response.ok)

	if (!response.ok) {
		const error = await response.text()
		console.error('-- error', error)
		throw new Error(error)
	}

	const data = await response.json()
	if (!data.USD)
		throw new Error(`no USD in response ${JSON.stringify(data)}`);
	return data.USD
}


exports.fetchExchangeRate = fetchExchangeRate;
