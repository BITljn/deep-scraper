import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDistributionRows,
  getProfileAvatar,
} from "../src/components/charts/holdingsDistribution.ts";

test("buildDistributionRows keeps only the first 20 positive weighted holdings", () => {
  const holdings = Array.from({ length: 24 }, (_, index) => ({
    rank: index + 1,
    ticker: `T${index + 1}`,
    company_name: `Company ${index + 1}`,
    price: null,
    price_label: "-",
    market_value: 1_000_000,
    market_value_label: `$${index + 1}M`,
    weight: index === 2 ? 0 : index + 1,
  }));

  const rows = buildDistributionRows(holdings);

  assert.equal(rows.length, 20);
  assert.equal(rows[0]?.ticker, "T1");
  assert.equal(rows[2]?.ticker, "T4");
  assert.equal(rows.at(-1)?.ticker, "T21");
  assert.equal(rows.some((row) => row.ticker === "T3"), false);
});

test("getProfileAvatar returns the selected profile initials and label", () => {
  assert.deepEqual(getProfileAvatar("ark", "ARK Daily"), {
    initials: "ARK",
    label: "ARK Daily",
    tone: "cyan",
  });
});
