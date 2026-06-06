const Database = require("better-sqlite3");

const db = new Database("./data/tour-deals.sqlite");

const summary = {
  kv: db.prepare("select * from kv").all(),
  prices: db
    .prepare("select count(*) as count, min(price_amount) as min_price, max(price_amount) as max_price from price_history")
    .get(),
  alerts: db.prepare("select count(*) as count from sent_alerts").get(),
  recent: db
    .prepare("select preset_id, deal_id, price_amount, price_currency, seen_at from price_history order by id desc limit 5")
    .all()
};

console.log(JSON.stringify(summary, null, 2));
db.close();
