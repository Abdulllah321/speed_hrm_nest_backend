import { Pool } from 'pg';

const livePool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/spl_live_temp',
});

const localPool = new Pool({
  connectionString: 'postgresql://postgres:root@localhost:5432/tenant_speed_main_mox1gfsi',
});

async function inspectMissingItemsAndMasters() {
  // Find all items in live that are missing in local
  const liveItems = await livePool.query(`SELECT id, "itemId", sku, "description", "brandId", "categoryId", "subCategoryId", "colorId", "sizeId", "seasonId" FROM "Item"`);
  const localItems = await localPool.query(`SELECT id FROM "Item"`);
  const localItemIds = new Set(localItems.rows.map(r => r.id));
  const missingItems = liveItems.rows.filter(r => !localItemIds.has(r.id));
  console.log(`Total Items in Live: ${liveItems.rows.length}, Local: ${localItems.rows.length}, Missing in Local: ${missingItems.length}`);

  if (missingItems.length > 0) {
    console.log('Sample missing items:', missingItems.slice(0, 5));

    // Check if any missing items have brands, categories, sizes, colors, seasons that don't exist locally
    const brandIds = [...new Set(missingItems.map(i => i.brandId).filter(Boolean))];
    const categoryIds = [...new Set(missingItems.map(i => i.categoryId).filter(Boolean))];
    const colorIds = [...new Set(missingItems.map(i => i.colorId).filter(Boolean))];
    const sizeIds = [...new Set(missingItems.map(i => i.sizeId).filter(Boolean))];
    const seasonIds = [...new Set(missingItems.map(i => i.seasonId).filter(Boolean))];

    if (brandIds.length > 0) {
      const localBrands = await localPool.query(`SELECT id FROM "Brand" WHERE id = ANY($1)`, [brandIds]);
      const localBrandIds = new Set(localBrands.rows.map(r => r.id));
      const missingBrands = brandIds.filter(id => !localBrandIds.has(id));
      console.log(`Missing Brands: ${missingBrands.length}`);
    }

    if (categoryIds.length > 0) {
      const localCats = await localPool.query(`SELECT id FROM "Category" WHERE id = ANY($1)`, [categoryIds]);
      const localCatIds = new Set(localCats.rows.map(r => r.id));
      const missingCats = categoryIds.filter(id => !localCatIds.has(id));
      console.log(`Missing Categories: ${missingCats.length}`);
    }

    if (colorIds.length > 0) {
      const localColors = await localPool.query(`SELECT id FROM "Color" WHERE id = ANY($1)`, [colorIds]);
      const localColorIds = new Set(localColors.rows.map(r => r.id));
      const missingColors = colorIds.filter(id => !localColorIds.has(id));
      console.log(`Missing Colors: ${missingColors.length}`);
    }

    if (sizeIds.length > 0) {
      const localSizes = await localPool.query(`SELECT id FROM "Size" WHERE id = ANY($1)`, [sizeIds]);
      const localSizeIds = new Set(localSizes.rows.map(r => r.id));
      const missingSizes = sizeIds.filter(id => !localSizeIds.has(id));
      console.log(`Missing Sizes: ${missingSizes.length}`);
    }

    if (seasonIds.length > 0) {
      const localSeasons = await localPool.query(`SELECT id FROM "Season" WHERE id = ANY($1)`, [seasonIds]);
      const localSeasonIds = new Set(localSeasons.rows.map(r => r.id));
      const missingSeasons = seasonIds.filter(id => !localSeasonIds.has(id));
      console.log(`Missing Seasons: ${missingSeasons.length}`);
    }
  }

  // Check supplier_ledger delta
  const liveSL = await livePool.query(`SELECT count(*) FROM supplier_ledger`);
  const localSL = await localPool.query(`SELECT count(*) FROM supplier_ledger`);
  console.log(`\nsupplier_ledger: Live = ${liveSL.rows[0].count}, Local = ${localSL.rows[0].count}`);

  // Check stock_ledgers delta for LANDED_COST and PURCHASE_RETURN_INV
  const liveSLLC = await livePool.query(`SELECT count(*) FROM stock_ledgers WHERE reference_type IN ('LANDED_COST', 'PURCHASE_RETURN_INV')`);
  const localSLLC = await localPool.query(`SELECT count(*) FROM stock_ledgers WHERE reference_type IN ('LANDED_COST', 'PURCHASE_RETURN_INV')`);
  console.log(`stock_ledgers (LANDED_COST & PURCHASE_RETURN_INV): Live = ${liveSLLC.rows[0].count}, Local = ${localSLLC.rows[0].count}`);

  // Check Finance vouchers delta
  const liveJV = await livePool.query(`SELECT count(*) FROM "JournalVoucher"`);
  const localJV = await localPool.query(`SELECT count(*) FROM "JournalVoucher"`);
  console.log(`\nJournal Vouchers: Live = ${liveJV.rows[0].count}, Local = ${localJV.rows[0].count}`);

  const livePV = await livePool.query(`SELECT count(*) FROM "PaymentVoucher"`);
  const localPV = await localPool.query(`SELECT count(*) FROM "PaymentVoucher"`);
  console.log(`Payment Vouchers: Live = ${livePV.rows[0].count}, Local = ${localPV.rows[0].count}`);

  const liveRV = await livePool.query(`SELECT count(*) FROM "ReceiptVoucher"`);
  const localRV = await localPool.query(`SELECT count(*) FROM "ReceiptVoucher"`);
  console.log(`Receipt Vouchers: Live = ${liveRV.rows[0].count}, Local = ${localRV.rows[0].count}`);

  await livePool.end();
  await localPool.end();
}

inspectMissingItemsAndMasters().catch(console.error);
