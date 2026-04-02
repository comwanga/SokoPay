use crate::error::{AppError, AppResult};
use crate::models::*;
use rusqlite::{params, OptionalExtension};
use tokio_rusqlite::Connection;
use uuid::Uuid;

pub struct Database {
    conn: Connection,
}

impl Database {
    pub async fn new(path: &str) -> AppResult<Self> {
        let file_path = path.strip_prefix("sqlite://").unwrap_or(path);
        let conn = Connection::open(file_path)
            .await
            .map_err(|e: rusqlite::Error| AppError::Database(e.to_string()))?;

        // Enable WAL mode for better read/write concurrency on the single connection.
        conn.call(|c| {
            c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
            Ok(())
        })
        .await
        .map_err(|e: rusqlite::Error| AppError::Database(e.to_string()))?;

        Ok(Self { conn })
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Versioned migrations
    // ─────────────────────────────────────────────────────────────────────────

    pub async fn run_migrations(&self) -> AppResult<()> {
        // Bootstrap the migration-tracking table before anything else.
        self.conn
            .call(|conn| {
                conn.execute_batch(
                    "CREATE TABLE IF NOT EXISTS _migrations (
                        version     INTEGER PRIMARY KEY,
                        name        TEXT NOT NULL,
                        applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
                    );",
                )?;
                Ok(())
            })
            .await
            .map_err(|e: rusqlite::Error| AppError::Database(e.to_string()))?;

        self.apply_migration(
            1,
            "001_initial",
            include_str!("../migrations/001_initial.sql"),
        )
        .await?;
        self.apply_migration(
            2,
            "002_indexes_and_offer_id",
            include_str!("../migrations/002_indexes_and_offer_id.sql"),
        )
        .await?;

        Ok(())
    }

    async fn apply_migration(
        &self,
        version: i64,
        name: &'static str,
        sql: &'static str,
    ) -> AppResult<()> {
        let already_applied = self
            .conn
            .call(move |conn| {
                let count: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM _migrations WHERE version = ?1",
                    params![version],
                    |r| r.get(0),
                )?;
                Ok(count > 0)
            })
            .await
            .map_err(|e: rusqlite::Error| AppError::Database(e.to_string()))?;

        if already_applied {
            return Ok(());
        }

        self.conn
            .call(move |conn| {
                conn.execute_batch(sql)?;
                conn.execute(
                    "INSERT INTO _migrations (version, name) VALUES (?1, ?2)",
                    params![version, name],
                )?;
                Ok(())
            })
            .await
            .map_err(|e: rusqlite::Error| AppError::Database(e.to_string()))?;

        tracing::info!("Applied migration {}: {}", version, name);
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Farmers
    // ─────────────────────────────────────────────────────────────────────────

    pub async fn create_farmer(&self, req: CreateFarmer) -> AppResult<Farmer> {
        let id = Uuid::new_v4().to_string();
        // B-1 fix: capture the UUID and re-fetch by that UUID, not last_insert_rowid().
        let id_clone = id.clone();
        let farmer = self
            .conn
            .call(move |conn| {
                conn.execute(
                    "INSERT INTO farmers (id, name, phone, cooperative) VALUES (?1, ?2, ?3, ?4)",
                    params![id_clone, req.name, req.phone, req.cooperative],
                )?;
                conn.query_row(
                    "SELECT id, name, phone, cooperative, created_at FROM farmers WHERE id = ?1",
                    params![id_clone],
                    |row| {
                        Ok(Farmer {
                            id: row.get(0)?,
                            name: row.get(1)?,
                            phone: row.get(2)?,
                            cooperative: row.get(3)?,
                            created_at: row.get(4)?,
                        })
                    },
                )
            })
            .await
            .map_err(|e: rusqlite::Error| AppError::Database(e.to_string()))?;
        Ok(farmer)
    }

    pub async fn list_farmers(&self) -> AppResult<Vec<Farmer>> {
        let farmers = self
            .conn
            .call(|conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, name, phone, cooperative, created_at
                     FROM farmers ORDER BY created_at DESC",
                )?;
                let rows = stmt.query_map([], |row| {
                    Ok(Farmer {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        phone: row.get(2)?,
                        cooperative: row.get(3)?,
                        created_at: row.get(4)?,
                    })
                })?;
                rows.collect::<rusqlite::Result<Vec<_>>>()
            })
            .await
            .map_err(|e: rusqlite::Error| AppError::Database(e.to_string()))?;
        Ok(farmers)
    }

    pub async fn get_farmer(&self, id: String) -> AppResult<Farmer> {
        let result = self
            .conn
            .call(move |conn| {
                conn.query_row(
                    "SELECT id, name, phone, cooperative, created_at FROM farmers WHERE id = ?1",
                    params![id],
                    |row| {
                        Ok(Farmer {
                            id: row.get(0)?,
                            name: row.get(1)?,
                            phone: row.get(2)?,
                            cooperative: row.get(3)?,
                            created_at: row.get(4)?,
                        })
                    },
                )
                .optional()
            })
            .await
            .map_err(|e: rusqlite::Error| AppError::Database(e.to_string()))?;

        result.ok_or_else(|| AppError::NotFound("Farmer not found".into()))
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Payments
    // ─────────────────────────────────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub async fn create_payment(
        &self,
        farmer_id: String,
        amount_sats: i64,
        amount_kes: f64,
        btc_kes_rate: f64,
        bolt12_offer: Option<String>,
        offer_id: Option<String>,
        crop_type: Option<String>,
        notes: Option<String>,
    ) -> AppResult<Payment> {
        let id = Uuid::new_v4().to_string();
        let payment = self
            .conn
            .call(move |conn| {
                conn.execute(
                    r#"INSERT INTO payments
                       (id, farmer_id, amount_sats, amount_kes, btc_kes_rate,
                        bolt12_offer, offer_id, crop_type, notes)
                       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"#,
                    params![
                        id,
                        farmer_id,
                        amount_sats,
                        amount_kes,
                        btc_kes_rate,
                        bolt12_offer,
                        offer_id,
                        crop_type,
                        notes
                    ],
                )?;
                conn.query_row(
                    "SELECT id, farmer_id, amount_sats, amount_kes, btc_kes_rate, status,
                            bolt12_offer, offer_id, lightning_payment_hash, mpesa_ref,
                            mpesa_request_id, crop_type, notes, created_at, updated_at
                     FROM payments WHERE rowid = last_insert_rowid()",
                    [],
                    map_payment_row,
                )
            })
            .await
            .map_err(|e: rusqlite::Error| AppError::Database(e.to_string()))?;
        Ok(payment)
    }

    /// List payments with optional pagination. `page` is 1-based; `per_page` max 200.
    pub async fn list_payments(
        &self,
        page: u32,
        per_page: u32,
    ) -> AppResult<Vec<PaymentWithFarmer>> {
        let per_page = per_page.min(200) as i64;
        let offset = ((page.saturating_sub(1)) as i64) * per_page;

        let payments = self
            .conn
            .call(move |conn| {
                let mut stmt = conn.prepare(
                    r#"SELECT p.id, p.farmer_id, p.amount_sats, p.amount_kes, p.btc_kes_rate,
                              p.status, p.bolt12_offer, p.offer_id,
                              p.lightning_payment_hash, p.mpesa_ref, p.mpesa_request_id,
                              p.crop_type, p.notes, p.created_at, p.updated_at,
                              f.name AS farmer_name, f.phone AS farmer_phone
                       FROM payments p
                       JOIN farmers f ON p.farmer_id = f.id
                       ORDER BY p.created_at DESC
                       LIMIT ?1 OFFSET ?2"#,
                )?;
                let rows = stmt.query_map(params![per_page, offset], |row| {
                    let payment = map_payment_row(row)?;
                    let farmer_name: String = row.get(15)?;
                    let farmer_phone: String = row.get(16)?;
                    Ok(PaymentWithFarmer {
                        payment,
                        farmer_name,
                        farmer_phone,
                    })
                })?;
                rows.collect::<rusqlite::Result<Vec<_>>>()
            })
            .await
            .map_err(|e: rusqlite::Error| AppError::Database(e.to_string()))?;
        Ok(payments)
    }

    pub async fn get_payment(&self, id: String) -> AppResult<Payment> {
        let result = self
            .conn
            .call(move |conn| {
                conn.query_row(
                    "SELECT id, farmer_id, amount_sats, amount_kes, btc_kes_rate, status,
                            bolt12_offer, offer_id, lightning_payment_hash, mpesa_ref,
                            mpesa_request_id, crop_type, notes, created_at, updated_at
                     FROM payments WHERE id = ?1",
                    params![id],
                    map_payment_row,
                )
                .optional()
            })
            .await
            .map_err(|e: rusqlite::Error| AppError::Database(e.to_string()))?;

        result.ok_or_else(|| AppError::NotFound("Payment not found".into()))
    }

    /// Update by explicit ID — kept for manual/admin use.
    #[allow(dead_code)]
    pub async fn update_payment_lightning(
        &self,
        id: String,
        payment_hash: String,
    ) -> AppResult<()> {
        self.conn
            .call(move |conn| {
                conn.execute(
                    "UPDATE payments SET lightning_payment_hash = ?1, status = 'lightning_received'
                     WHERE id = ?2",
                    params![payment_hash, id],
                )?;
                Ok(())
            })
            .await
            .map_err(|e: rusqlite::Error| AppError::Database(e.to_string()))
    }

    /// Find a pending payment by its BOLT12 offer_id and advance it to `lightning_received`.
    /// Returns `true` if a row was updated, `false` if no matching pending payment was found.
    pub async fn update_payment_lightning_by_offer_id(
        &self,
        offer_id: String,
        payment_hash: String,
    ) -> AppResult<bool> {
        let rows_changed = self
            .conn
            .call(move |conn| {
                let n = conn.execute(
                    "UPDATE payments
                     SET lightning_payment_hash = ?1, status = 'lightning_received'
                     WHERE offer_id = ?2 AND status = 'pending'",
                    params![payment_hash, offer_id],
                )?;
                Ok(n)
            })
            .await
            .map_err(|e: rusqlite::Error| AppError::Database(e.to_string()))?;
        Ok(rows_changed > 0)
    }

    /// Atomically transition a payment from `lightning_received` → `disbursing`.
    ///
    /// The `UPDATE … WHERE status = 'lightning_received'` is atomic on SQLite's
    /// serialized connection, preventing double-disbursement on concurrent retries.
    /// Returns `true` if the transition succeeded, `false` if the payment was not
    /// in the expected state (caller should return 409 Conflict).
    pub async fn try_start_disburse(
        &self,
        id: String,
        mpesa_request_id: String,
    ) -> AppResult<bool> {
        let rows_changed = self
            .conn
            .call(move |conn| {
                let n = conn.execute(
                    "UPDATE payments SET mpesa_request_id = ?1, status = 'disbursing'
                     WHERE id = ?2 AND status = 'lightning_received'",
                    params![mpesa_request_id, id],
                )?;
                Ok(n)
            })
            .await
            .map_err(|e: rusqlite::Error| AppError::Database(e.to_string()))?;
        Ok(rows_changed > 0)
    }

    pub async fn complete_payment(
        &self,
        mpesa_request_id: String,
        mpesa_ref: String,
    ) -> AppResult<()> {
        self.conn
            .call(move |conn| {
                conn.execute(
                    "UPDATE payments SET mpesa_ref = ?1, status = 'completed'
                     WHERE mpesa_request_id = ?2",
                    params![mpesa_ref, mpesa_request_id],
                )?;
                Ok(())
            })
            .await
            .map_err(|e: rusqlite::Error| AppError::Database(e.to_string()))
    }

    pub async fn fail_payment(&self, mpesa_request_id: String) -> AppResult<()> {
        self.conn
            .call(move |conn| {
                conn.execute(
                    "UPDATE payments SET status = 'failed' WHERE mpesa_request_id = ?1",
                    params![mpesa_request_id],
                )?;
                Ok(())
            })
            .await
            .map_err(|e: rusqlite::Error| AppError::Database(e.to_string()))
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Rate cache
    // ─────────────────────────────────────────────────────────────────────────

    pub async fn get_cached_rate(&self) -> Option<RateCache> {
        self.conn
            .call(|conn| {
                conn.query_row(
                    "SELECT id, btc_kes, btc_usd, fetched_at FROM rate_cache WHERE id = 1",
                    [],
                    |row| {
                        Ok(RateCache {
                            id: row.get(0)?,
                            btc_kes: row.get(1)?,
                            btc_usd: row.get(2)?,
                            fetched_at: row.get(3)?,
                        })
                    },
                )
                .optional()
            })
            .await
            .ok()
            .flatten()
    }

    pub async fn upsert_rate(&self, btc_kes: f64, btc_usd: f64) -> AppResult<()> {
        self.conn
            .call(move |conn| {
                conn.execute(
                    r#"INSERT INTO rate_cache (id, btc_kes, btc_usd)
                       VALUES (1, ?1, ?2)
                       ON CONFLICT(id) DO UPDATE SET
                           btc_kes    = excluded.btc_kes,
                           btc_usd    = excluded.btc_usd,
                           fetched_at = datetime('now')"#,
                    params![btc_kes, btc_usd],
                )?;
                Ok(())
            })
            .await
            .map_err(|e: rusqlite::Error| AppError::Database(e.to_string()))
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Dashboard
    // ─────────────────────────────────────────────────────────────────────────

    pub async fn get_stats(&self) -> AppResult<DashboardStats> {
        let rate = self.get_cached_rate().await.map(|r| r.btc_kes);

        let stats = self
            .conn
            .call(move |conn| {
                let total_farmers: i64 =
                    conn.query_row("SELECT COUNT(*) FROM farmers", [], |r| r.get(0))?;
                let total_payments: i64 =
                    conn.query_row("SELECT COUNT(*) FROM payments", [], |r| r.get(0))?;
                let (total_paid_kes, total_paid_sats): (f64, i64) = conn.query_row(
                    "SELECT COALESCE(SUM(amount_kes), 0.0), COALESCE(SUM(amount_sats), 0)
                     FROM payments WHERE status = 'completed'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )?;
                let pending_disbursements: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM payments WHERE status = 'lightning_received'",
                    [],
                    |r| r.get(0),
                )?;
                Ok(DashboardStats {
                    total_farmers,
                    total_payments,
                    total_paid_kes,
                    total_paid_sats,
                    pending_disbursements,
                    recent_rate: rate,
                })
            })
            .await
            .map_err(|e: rusqlite::Error| AppError::Database(e.to_string()))?;

        Ok(stats)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Row mapper helpers
// ─────────────────────────────────────────────────────────────────────────────

fn map_payment_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Payment> {
    Ok(Payment {
        id: row.get(0)?,
        farmer_id: row.get(1)?,
        amount_sats: row.get(2)?,
        amount_kes: row.get(3)?,
        btc_kes_rate: row.get(4)?,
        status: row.get(5)?,
        bolt12_offer: row.get(6)?,
        offer_id: row.get(7)?,
        lightning_payment_hash: row.get(8)?,
        mpesa_ref: row.get(9)?,
        mpesa_request_id: row.get(10)?,
        crop_type: row.get(11)?,
        notes: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Spin up an in-memory SQLite database with migrations applied.
    async fn test_db() -> Database {
        let db = Database::new(":memory:").await.expect("in-memory DB");
        db.run_migrations().await.expect("migrations");
        db
    }

    fn farmer_req(name: &str, phone: &str) -> CreateFarmer {
        CreateFarmer {
            name: name.to_string(),
            phone: phone.to_string(),
            cooperative: "Test Coop".to_string(),
        }
    }

    // ── Farmer tests ─────────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_create_and_get_farmer() {
        let db = test_db().await;
        let created = db
            .create_farmer(farmer_req("Alice", "0712345678"))
            .await
            .unwrap();
        assert!(!created.id.is_empty(), "UUID should be set");
        assert_eq!(created.name, "Alice");
        assert_eq!(created.phone, "0712345678");

        let fetched = db.get_farmer(created.id.clone()).await.unwrap();
        assert_eq!(
            fetched.id, created.id,
            "B-1: re-fetch must return the same UUID"
        );
        assert_eq!(fetched.name, "Alice");
    }

    #[tokio::test]
    async fn test_list_farmers() {
        let db = test_db().await;
        db.create_farmer(farmer_req("Bob", "0712345671"))
            .await
            .unwrap();
        db.create_farmer(farmer_req("Carol", "0712345672"))
            .await
            .unwrap();
        let all = db.list_farmers().await.unwrap();
        assert_eq!(all.len(), 2);
    }

    #[tokio::test]
    async fn test_get_farmer_not_found() {
        let db = test_db().await;
        let err = db.get_farmer("nonexistent-id".into()).await.unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    // ── Payment state machine tests ───────────────────────────────────────────

    async fn seed_payment(db: &Database) -> (String, String) {
        let f = db
            .create_farmer(farmer_req("Dan", "0712345679"))
            .await
            .unwrap();
        let p = db
            .create_payment(
                f.id.clone(),
                5_000,
                500.0,
                10_000_000.0,
                Some("lno1test".into()),
                Some("aabbccdd".into()),
                None,
                None,
            )
            .await
            .unwrap();
        (f.id, p.id)
    }

    #[tokio::test]
    async fn test_payment_status_starts_pending() {
        let db = test_db().await;
        let (_, pid) = seed_payment(&db).await;
        let p = db.get_payment(pid).await.unwrap();
        assert_eq!(p.status, "pending");
    }

    #[tokio::test]
    async fn test_advance_to_lightning_received_by_offer_id() {
        let db = test_db().await;
        let (_, pid) = seed_payment(&db).await;
        let advanced = db
            .update_payment_lightning_by_offer_id("aabbccdd".into(), "deadbeef".into())
            .await
            .unwrap();
        assert!(advanced, "Should advance the pending payment");
        let p = db.get_payment(pid).await.unwrap();
        assert_eq!(p.status, "lightning_received");
        assert_eq!(p.lightning_payment_hash.as_deref(), Some("deadbeef"));
    }

    #[tokio::test]
    async fn test_advance_by_offer_id_returns_false_if_no_match() {
        let db = test_db().await;
        let _ = seed_payment(&db).await;
        let advanced = db
            .update_payment_lightning_by_offer_id("unknown-offer-id".into(), "hash".into())
            .await
            .unwrap();
        assert!(!advanced);
    }

    #[tokio::test]
    async fn test_try_start_disburse_atomic() {
        let db = test_db().await;
        let (_, pid) = seed_payment(&db).await;

        // Advance to lightning_received first.
        db.update_payment_lightning_by_offer_id("aabbccdd".into(), "hash1".into())
            .await
            .unwrap();

        // First disburse attempt should succeed.
        let ok = db
            .try_start_disburse(pid.clone(), "req-id-001".into())
            .await
            .unwrap();
        assert!(ok, "First disburse should succeed");

        // R-5: Second attempt must fail — status is now 'disbursing', not 'lightning_received'.
        let retry = db
            .try_start_disburse(pid.clone(), "req-id-002".into())
            .await
            .unwrap();
        assert!(!retry, "Duplicate disburse must be rejected atomically");

        let p = db.get_payment(pid).await.unwrap();
        assert_eq!(p.status, "disbursing");
        assert_eq!(p.mpesa_request_id.as_deref(), Some("req-id-001"));
    }

    #[tokio::test]
    async fn test_complete_payment() {
        let db = test_db().await;
        let (_, pid) = seed_payment(&db).await;
        db.update_payment_lightning_by_offer_id("aabbccdd".into(), "hash".into())
            .await
            .unwrap();
        db.try_start_disburse(pid.clone(), "req-999".into())
            .await
            .unwrap();
        db.complete_payment("req-999".into(), "MPESA_TXN_ABC".into())
            .await
            .unwrap();
        let p = db.get_payment(pid).await.unwrap();
        assert_eq!(p.status, "completed");
        assert_eq!(p.mpesa_ref.as_deref(), Some("MPESA_TXN_ABC"));
    }

    #[tokio::test]
    async fn test_fail_payment() {
        let db = test_db().await;
        let (_, pid) = seed_payment(&db).await;
        db.update_payment_lightning_by_offer_id("aabbccdd".into(), "hash".into())
            .await
            .unwrap();
        db.try_start_disburse(pid.clone(), "req-fail".into())
            .await
            .unwrap();
        db.fail_payment("req-fail".into()).await.unwrap();
        let p = db.get_payment(pid).await.unwrap();
        assert_eq!(p.status, "failed");
    }

    #[tokio::test]
    async fn test_pagination() {
        let db = test_db().await;
        let f = db
            .create_farmer(farmer_req("Eve", "0712000001"))
            .await
            .unwrap();
        for i in 0..5u64 {
            db.create_payment(
                f.id.clone(),
                (i * 1000) as i64,
                i as f64 * 100.0,
                10_000_000.0,
                None,
                None,
                None,
                None,
            )
            .await
            .unwrap();
        }
        let page1 = db.list_payments(1, 3).await.unwrap();
        assert_eq!(page1.len(), 3);
        let page2 = db.list_payments(2, 3).await.unwrap();
        assert_eq!(page2.len(), 2);
        // Ensure no overlap.
        let ids1: std::collections::HashSet<_> = page1.iter().map(|p| &p.payment.id).collect();
        let ids2: std::collections::HashSet<_> = page2.iter().map(|p| &p.payment.id).collect();
        assert!(ids1.is_disjoint(&ids2));
    }
}
