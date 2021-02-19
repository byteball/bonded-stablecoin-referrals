CREATE TABLE IF NOT EXISTS users (
	address CHAR(32) NOT NULL PRIMARY KEY,
	referrer_address CHAR(32) NULL,
	first_unit CHAR(44) NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- query separator
CREATE INDEX IF NOT EXISTS byRef ON users(referrer_address);
-- query separator
CREATE TABLE IF NOT EXISTS suspended_referrers (
	address CHAR(32) NOT NULL PRIMARY KEY,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- query separator

CREATE TABLE IF NOT EXISTS distributions (
	distribution_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	total_usd_balance DECIMAL(15, 4) NULL, -- including unreferred users
	total_unscaled_rewards DECIMAL(15, 4) NULL, -- in USD
	total_rewards DECIMAL(15, 4) NULL, -- in USD
	is_frozen TINYINT NOT NULL DEFAULT 0,
	bought_reward_asset TINYINT NOT NULL DEFAULT 0,
	is_completed TINYINT NOT NULL DEFAULT 0,
	snapshot_time NOT NULL DEFAULT CURRENT_TIMESTAMP,
	distribution_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- query separator
INSERT OR IGNORE INTO distributions (distribution_id, distribution_date) VALUES (1, '2020-11-15 12:00:00');
-- query separator

-- lists all addresses, even those that are not referred
CREATE TABLE IF NOT EXISTS balances (
	distribution_id INT NOT NULL,
	address CHAR(32) NOT NULL,
	usd_balance DECIMAL(15, 4) NOT NULL,
	details TEXT NOT NULL,
	UNIQUE (distribution_id, address),
	FOREIGN KEY (distribution_id) REFERENCES distributions(distribution_id)
);
-- query separator
CREATE INDEX IF NOT EXISTS balancesByAddress ON balances(address);
-- query separator

CREATE TABLE IF NOT EXISTS rewards (
	distribution_id INT NOT NULL,
	address CHAR(32) NOT NULL,
	usd_reward DECIMAL(15, 4) NOT NULL,
	share DOUBLE NOT NULL,
	reward_in_smallest_units INT NOT NULL, -- in IUSD smallest units
	payment_unit CHAR(44) NULL,
	UNIQUE (distribution_id, address),
	FOREIGN KEY (distribution_id) REFERENCES distributions(distribution_id)
);
-- query separator
CREATE INDEX IF NOT EXISTS rewardsByAddress ON rewards(address);
