require("dotenv").config();
var express = require("express");
const { Pool } = require("pg");
var cors = require("cors");
const crypto = require("crypto");

// for self-signed cert of postgres
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const EVENT_SEPARATOR = "|";

var db_pool = new Pool({
  user: process.env.DB_USER || "postgres",
  host: process.env.DB_HOST || "postgres-container",
  database: process.env.DB_DATABASE || "postgres",
  password: process.env.DB_PASSWD || "postgres",
  port: parseInt(process.env.DB_PORT || "5432"),
  max: process.env.DB_MAX_CONNECTIONS || 10, // maximum number of clients!!
  // ssl: process.env.DB_SSL == "true" ? true : false,
  ssl: false,
});

const api_port = parseInt(process.env.API_PORT || "8003");
const api_host = process.env.API_HOST || "0.0.0.0";

var app = express();
// app.set("trust proxy", parseInt(process.env.API_TRUSTED_PROXY_CNT || "0"));

var corsOptions = {
  origin: "*",
  optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
};
app.use([cors(corsOptions)]);

app.get("/", (request, response) => response.send(request.ip));
app.get("/v1/runes/ip", (request, response) => response.send(request.ip));

async function query_db(query, params = []) {
  return await db_pool.query(query, params);
}

async function get_block_height_of_db() {
  try {
    let res = await query_db(
      "SELECT max(block_height) as max_block_height FROM runes_block_hashes;"
    );
    return res.rows[0].max_block_height;
  } catch (err) {
    console.log(err);
    return -1;
  }
}

app.get("/v1/runes/block_height", async (request, response) => {
  try {
    console.log(
      `${request.protocol}://${request.get("host")}${request.originalUrl}`
    );
    let block_height = await get_block_height_of_db();
    response.send(block_height + "");
  } catch (err) {
    console.log(err);
    response.status(500).send({ error: "internal error", result: null });
  }
});

// get all balances of a given pkscript or address at the start of a given block_height
app.get("/v1/runes/balance_on_block", async (request, response) => {
  try {
    console.log(
      `${request.protocol}://${request.get("host")}${request.originalUrl}`
    );
    let block_height = request.query.block_height;
    // one of pkscript or address must be provided
    let pkscript = request.query.pkscript || "";
    let address = request.query.address || "";

    let current_block_height = await get_block_height_of_db();
    if (block_height > current_block_height + 1) {
      response
        .status(400)
        .send({ error: "block not indexed yet", result: null });
      return;
    }

    let pkscript_selector = "pkscript";
    let pkscript_selector_value = pkscript;
    if (address != "") {
      pkscript_selector = "wallet_addr";
      pkscript_selector_value = address;
    }

    let query =
      `select pkscript, wallet_addr, rite.rune_id, rite.rune_name, sum(balance) as total_balance
                  from runes_outpoint_to_balances rotb, unnest(rune_ids, balances) as u(rune_id, balance)
                  left join runes_id_to_entry rite on rite.rune_id = u.rune_id
                  where ` +
      pkscript_selector +
      ` = $1 and block_height < $2 and (spent_block_height is null or spent_block_height >= $2)
                  group by pkscript, wallet_addr, rite.rune_id, rite.rune_name;`;
    let res = await query_db(query, [pkscript_selector_value, block_height]);

    response.send({
      error: null,
      result: res.rows,
      db_block_height: current_block_height,
    });
  } catch (err) {
    console.log(err);
    response.status(500).send({ error: "internal error", result: null });
  }
});

// get all runes activity of a given block height
app.get("/v1/runes/activity_on_block", async (request, response) => {
  try {
    console.log(
      `${request.protocol}://${request.get("host")}${request.originalUrl}`
    );

    let block_height = request.query.block_height;

    let current_block_height = await get_block_height_of_db();
    if (block_height > current_block_height) {
      response
        .status(400)
        .send({ error: "block not indexed yet", result: null });
      return;
    }

    let res1 = await query_db(
      "select event_type_name, event_type_id from runes_event_types;"
    );
    let event_type_id_to_name = {};
    res1.rows.forEach((row) => {
      event_type_id_to_name[row.event_type_id] = row.event_type_name;
    });

    console.log({ event_type_id_to_name });

    // let query = `select event_type, outpoint, wallet_addr, rune_id, amount, txid
    //               from runes_events re
    //               where block_height = $1
    //               order by id asc;`;

    let query = `
  select re.event_type, re.outpoint, re.wallet_addr, re.rune_id, rite.rune_name, rite.divisibility, re.amount, re.txid
  from runes_events re
  left join runes_id_to_entry rite on re.rune_id = rite.rune_id
  where re.block_height = $1
  order by re.id asc;
`;

    console.log({ query });

    let res = await query_db(query, [block_height]);

    const eventMap = new Map();

    for (const row of res.rows) {
      let event = {
        event_type: event_type_id_to_name[row.event_type],
        outpoint: row.outpoint,
        pkscript: row.pkscript,
        wallet_addr: row.wallet_addr,
        rune_id: row.rune_id,
        name: row.rune_name,
        divisibility: row.divisibility,
        amount: row.amount,
        txid: row.txid,
      };

      if (eventMap.has(row.txid)) {
        eventMap.get(row.txid).push(event);
      } else {
        eventMap.set(row.txid, [event]);
      }
    }

    // Convert Map to an object
    const resultObject = Object.fromEntries(eventMap);

    // Convert the result object to JSON
    const jsonString = JSON.stringify(resultObject);

    // Now eventMap contains the grouped events by txid

    response.send({
      error: null,
      result: resultObject,
      db_block_height: current_block_height,
    });
  } catch (err) {
    console.log(err);
    response.status(500).send({ error: "internal error", result: null });
  }
});

// get all runes activity of a given block height
app.get("/v1/runes/activity_of_address", async (request, response) => {
  try {
    console.log(
      `${request.protocol}://${request.get("host")}${request.originalUrl}`
    );

    let address = request.query.address;

    let res1 = await query_db(
      "select event_type_name, event_type_id from runes_event_types;"
    );
    let event_type_id_to_name = {};
    res1.rows.forEach((row) => {
      event_type_id_to_name[row.event_type_id] = row.event_type_name;
    });

    console.log({ event_type_id_to_name });

    // let query = `select event_type, outpoint, wallet_addr, rune_id, amount, txid
    //               from runes_events re
    //               where wallet_addr = $1
    //               order by id asc;`;

    let query = `
  select re.event_type, re.outpoint, re.wallet_addr, re.rune_id, rite.rune_name, rite.divisibility, re.amount, re.txid
  from runes_events re
  left join runes_id_to_entry rite on re.rune_id = rite.rune_id
  where re.wallet_addr = $1
  order by re.id asc;
`;

    console.log({ query });
    let res = await query_db(query, [address]);
    const eventMap = new Map();

    for (const row of res.rows) {
      let event = {
        event_type: event_type_id_to_name[row.event_type],
        outpoint: row.outpoint,
        pkscript: row.pkscript,
        wallet_addr: row.wallet_addr,
        rune_id: row.rune_id,
        name: row.rune_name,
        divisibility: row.divisibility,
        amount: row.amount,
        txid: row.txid,
      };

      if (eventMap.has(row.txid)) {
        eventMap.get(row.txid).push(event);
      } else {
        eventMap.set(row.txid, [event]);
      }
    }

    // Convert Map to an object
    const resultObject = Object.fromEntries(eventMap);

    // Convert the result object to JSON
    const jsonString = JSON.stringify(resultObject);

    // Now eventMap contains the grouped events by txid

    response.send({
      error: null,
      result: resultObject,
    });
  } catch (err) {
    console.log(err);
    response.status(500).send({ error: "internal error", result: null });
  }
});

app.get(
  "/v1/runes/get_current_balance_of_wallet",
  async (request, response) => {
    try {
      console.log(
        `${request.protocol}://${request.get("host")}${request.originalUrl}`
      );
      let address = request.query.address || "";
      let pkscript = request.query.pkscript || "";

      let pkscript_selector = "pkscript";
      let pkscript_selector_value = pkscript;
      if (address != "") {
        pkscript_selector = "wallet_addr";
        pkscript_selector_value = address;
      }

      let current_block_height = await get_block_height_of_db();
      let query =
        ` select pkscript, wallet_addr, rite.rune_id, rite.rune_name, sum(balance) as total_balance
                  from runes_outpoint_to_balances rotb, unnest(rune_ids, balances) as u(rune_id, balance)
                  left join runes_id_to_entry rite on rite.rune_id = u.rune_id
                  where ` +
        pkscript_selector +
        ` = $1 and spent = false
                  group by pkscript, wallet_addr, rite.rune_id, rite.rune_name;`;
      let params = [pkscript_selector_value];

      let res = await query_db(query, params);

      response.send({
        error: null,
        result: res.rows,
        db_block_height: current_block_height,
      });
    } catch (err) {
      console.log(err);
      response.status(500).send({ error: "internal error", result: null });
    }
  }
);

app.get("/v1/runes/activity_of_address_on_block", async (request, response) => {
  try {
    console.log(
      `${request.protocol}://${request.get("host")}${request.originalUrl}`
    );

    let res1 = await query_db(
      "select event_type_name, event_type_id from runes_event_types;"
    );
    let event_type_id_to_name = {};
    res1.rows.forEach((row) => {
      event_type_id_to_name[row.event_type_id] = row.event_type_name;
    });

    console.log({ event_type_id_to_name });
    let address = request.query.address;
    let block_height = request.query.block_height;

    let whereClauses = [];
    let queryParams = [];

    if (address) {
      whereClauses.push("re.wallet_addr = $1");
      queryParams.push(address);
    }
    if (block_height) {
      whereClauses.push("re.block_height = $" + (queryParams.length + 1));
      queryParams.push(block_height);
    }

    let whereClause =
      whereClauses.length > 0 ? "where " + whereClauses.join(" and ") : "";

    let initialQuery = `
  select re.event_type, re.outpoint, re.wallet_addr, re.block_height, re.rune_id, rite.rune_name, rite.divisibility, re.amount, re.txid
  from runes_events re
  left join runes_id_to_entry rite on re.rune_id = rite.rune_id
  ${whereClause}
  order by re.id asc;
`;

    console.log({ initialQuery });
    let initialResult = await query_db(initialQuery, queryParams);

    // console.log({ initialResult });

    // Extract txids from the initial result set
    let txids = initialResult.rows.map((row) => row.txid);
    if (txids.length === 0) {
      return response.send({
        error: null,
        result: resultObject,
      });
    }

    // Construct the second query to fetch items with the same txids
    let txidPlaceholders = txids.map((_, index) => `$${index + 1}`).join(", ");
    let secondQuery = `
  select re.event_type, re.outpoint, re.wallet_addr, re.block_height, re.rune_id, rite.rune_name, rite.divisibility, re.amount, re.txid
  from runes_events re
  left join runes_id_to_entry rite on re.rune_id = rite.rune_id
  where re.txid in (${txidPlaceholders})
  order by re.id asc;
`;

    console.log({ secondQuery });
    let finalResult = await query_db(secondQuery, txids);

    // console.log({ finalResult });

    const eventMap = new Map();

    for (const row of finalResult.rows) {
      let event = {
        event_type: event_type_id_to_name[row.event_type],
        outpoint: row.outpoint,
        pkscript: row.pkscript,
        wallet_addr: row.wallet_addr,
        rune_id: row.rune_id,
        name: row.rune_name,
        divisibility: row.divisibility,
        amount: row.amount,
        txid: row.txid,
        block_height: row.block_height,
      };

      if (eventMap.has(row.txid)) {
        eventMap.get(row.txid).push(event);
      } else {
        eventMap.set(row.txid, [event]);
      }
    }

    // Convert Map to an object
    const resultObject = Object.fromEntries(eventMap);

    // Now eventMap contains the grouped events by txid

    response.send({
      error: null,
      result: resultObject,
    });
  } catch (err) {
    console.log(err);
    response.status(500).send({ error: "internal error", result: null });
  }
});

app.get(
  "/v1/runes/get_unspent_rune_outpoints_of_wallet",
  async (request, response) => {
    try {
      console.log(
        `${request.protocol}://${request.get("host")}${request.originalUrl}`
      );

      let address = request.query.address || "";
      let pkscript = request.query.pkscript || "";

      let pkscript_selector = "pkscript";
      let pkscript_selector_value = pkscript;
      if (address != "") {
        pkscript_selector = "wallet_addr";
        pkscript_selector_value = address;
      }

      let current_block_height = await get_block_height_of_db();
      let query =
        ` select pkscript, wallet_addr, rotb.outpoint, rotb.rune_ids, rotb.balances
                  from runes_outpoint_to_balances rotb
                  where ` +
        pkscript_selector +
        ` = $1 and spent = false;`;
      let params = [pkscript_selector_value];

      let res = await query_db(query, params);
      response.send({
        error: null,
        result: res.rows,
        db_block_height: current_block_height,
      });
    } catch (err) {
      console.log(err);
      response.status(500).send({ error: "internal error", result: null });
    }
  }
);

app.get("/v1/runes/holders", async (request, response) => {
  try {
    console.log(
      `${request.protocol}://${request.get("host")}${request.originalUrl}`
    );

    let rune_name = request.query.rune_name.toUpperCase() || "";
    let rune_id = request.query.rune_id || "";

    let current_block_height = await get_block_height_of_db();
    if (rune_name == "") {
      let rune_name_q = await query_db(
        "select rune_name from runes_id_to_entry where rune_id = $1;",
        [rune_id]
      );
      if (rune_name_q.rows.length == 0) {
        response.status(400).send({ error: "rune not found", result: null });
        return;
      }
      rune_name = rune_name_q.rows[0].rune_name;
    }
    if (rune_id == "") {
      let rune_id_q = await query_db(
        "select rune_id from runes_id_to_entry where rune_name = $1;",
        [rune_name]
      );
      if (rune_id_q.rows.length == 0) {
        response.status(400).send({ error: "rune not found", result: null });
        return;
      }
      rune_id = rune_id_q.rows[0].rune_id;
    }

    let query = ` select pkscript, wallet_addr, rune_id, sum(balance) as total_balance
                  from runes_outpoint_to_balances rotb, unnest(rune_ids, balances) as u(rune_id, balance)
                  where rune_id = $1 and spent = false
                  group by pkscript, wallet_addr, rune_id
                  order by total_balance desc;`;
    let params = [rune_id];

    let res = await query_db(query, params);
    let rows = res.rows;
    // order rows using parseInt(total_balance) desc
    rows.sort((a, b) => parseInt(b.total_balance) - parseInt(a.total_balance));
    for (let i = 0; i < rows.length; i++) {
      rows[i].rune_name = rune_name;
    }

    response.send({
      error: null,
      result: rows,
      db_block_height: current_block_height,
    });
  } catch (err) {
    console.log(err);
    response.status(500).send({ error: "internal error", result: null });
  }
});

app.get("/v1/runes/get_hash_of_all_activity", async (request, response) => {
  try {
    console.log(
      `${request.protocol}://${request.get("host")}${request.originalUrl}`
    );
    let block_height = request.query.block_height;

    let current_block_height = await get_block_height_of_db();
    if (block_height > current_block_height) {
      response
        .status(400)
        .send({ error: "block not indexed yet", result: null });
      return;
    }

    let query = `select cumulative_event_hash, block_event_hash
                  from runes_cumulative_event_hashes
                  where block_height = $1;`;
    let res = await query_db(query, [block_height]);
    if (res.rows.length == 0) {
      response.status(400).send({ error: "block not indexed", result: null });
      return;
    }
    let cumulative_event_hash = res.rows[0].cumulative_event_hash;
    let block_event_hash = res.rows[0].block_event_hash;

    let res2 = await query_db(
      "select indexer_version from runes_indexer_version;"
    );
    let indexer_version = res2.rows[0].indexer_version;

    response.send({
      error: null,
      result: {
        cumulative_event_hash: cumulative_event_hash,
        block_event_hash: block_event_hash,
        indexer_version: indexer_version,
        block_height: block_height,
      },
    });
  } catch (err) {
    console.log(err);
    response.status(500).send({ error: "internal error", result: null });
  }
});

// get all events with a specific transaction ID
app.get("/v1/runes/event", async (request, response) => {
  try {
    console.log(
      `${request.protocol}://${request.get("host")}${request.originalUrl}`
    );
    let res1 = await query_db(
      "select event_type_name, event_type_id from runes_event_types;"
    );
    let event_type_id_to_name = {};

    let transaction_id = request.query.transaction_id;
    if (!transaction_id) {
      response
        .status(400)
        .send({ error: "transaction_id is required", result: null });
      return;
    }

    res1.rows.forEach((row) => {
      event_type_id_to_name[row.event_type_id] = row.event_type_name;
    });

    let query = `select event_type, outpoint, pkscript, wallet_addr, rune_id, amount
                  from runes_events re
                  where txid = $1
                  order by id asc;`;
    let res = await query_db(query, [transaction_id]);
    let result = [];
    for (const row of res.rows) {
      result.push({
        event_type: event_type_id_to_name[row.event_type],
        outpoint: row.outpoint,
        pkscript: row.pkscript,
        wallet_addr: row.wallet_addr,
        rune_id: row.rune_id,
        amount: row.amount,
      });
    }
    response.send({ error: null, result: result });
  } catch (err) {
    console.log(err);
    response.status(500).send({ error: "internal error", result: null });
  }
});

app.listen(api_port, api_host);

console.log(`runes_api listening on ${api_host}:${api_port}`);
