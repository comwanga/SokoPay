use anyhow::Result;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

pub async fn create_pool(database_url: &str) -> Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect(database_url)
        .await?;
    Ok(pool)
}

pub async fn run_migrations(pool: &PgPool) -> Result<()> {
    sqlx::migrate!("./migrations").run(pool).await?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration tests – marketplace schema (migration 005)
// Requires a live PostgreSQL instance; sqlx::test spins up a temp DB per test.
// Run with:  cargo test --lib db::tests
// ─────────────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use rust_decimal::Decimal;
    use rust_decimal_macros::dec;
    use sha2::{Digest, Sha256};
    use sqlx::PgPool;
    use uuid::Uuid;

    // ── Fixtures ──────────────────────────────────────────────────────────────

    async fn insert_farmer(pool: &PgPool, name: &str) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO farmers (name, pin_hash) VALUES ($1, 'fakehash') RETURNING id",
        )
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn insert_product(
        pool: &PgPool,
        seller_id: Uuid,
        title: &str,
        price_kes: Decimal,
        qty: Decimal,
    ) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO products (seller_id, title, price_kes, quantity_avail)
             VALUES ($1, $2, $3, $4) RETURNING id",
        )
        .bind(seller_id)
        .bind(title)
        .bind(price_kes)
        .bind(qty)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn insert_order(
        pool: &PgPool,
        product_id: Uuid,
        seller_id: Uuid,
        buyer_id: Uuid,
        quantity: Decimal,
        unit_price_kes: Decimal,
    ) -> Uuid {
        let total_kes = (unit_price_kes * quantity).round_dp(2);
        sqlx::query_scalar(
            "INSERT INTO orders
                 (product_id, seller_id, buyer_id, quantity, unit_price_kes, total_kes)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
        )
        .bind(product_id)
        .bind(seller_id)
        .bind(buyer_id)
        .bind(quantity)
        .bind(unit_price_kes)
        .bind(total_kes)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn insert_payment(pool: &PgPool, order_id: Uuid, amount_sats: i64) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO payments (order_id, bolt11, amount_sats, amount_kes, rate_used)
             VALUES ($1, 'lnbc...fake', $2, 1000.00, 15000000.0000) RETURNING id",
        )
        .bind(order_id)
        .bind(amount_sats)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    // ── Product tests ─────────────────────────────────────────────────────────

    #[sqlx::test(migrations = "./migrations")]
    async fn test_create_product_persists(pool: PgPool) {
        let seller_id = insert_farmer(&pool, "Alice").await;
        let product_id = insert_product(&pool, seller_id, "Maize", dec!(500.00), dec!(100.0)).await;

        let row: (String, Decimal, Decimal) =
            sqlx::query_as("SELECT title, price_kes, quantity_avail FROM products WHERE id = $1")
                .bind(product_id)
                .fetch_one(&pool)
                .await
                .unwrap();

        assert_eq!(row.0, "Maize");
        assert_eq!(row.1, dec!(500.00));
        assert_eq!(row.2, dec!(100.0));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn test_product_price_zero_rejected(pool: PgPool) {
        let seller_id = insert_farmer(&pool, "Alice").await;
        let err = sqlx::query(
            "INSERT INTO products (seller_id, title, price_kes, quantity_avail)
             VALUES ($1, 'Maize', 0, 10)",
        )
        .bind(seller_id)
        .execute(&pool)
        .await;
        assert!(
            err.is_err(),
            "price_kes = 0 should violate CHECK constraint"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn test_product_price_negative_rejected(pool: PgPool) {
        let seller_id = insert_farmer(&pool, "Alice").await;
        let err = sqlx::query(
            "INSERT INTO products (seller_id, title, price_kes, quantity_avail)
             VALUES ($1, 'Maize', -50, 10)",
        )
        .bind(seller_id)
        .execute(&pool)
        .await;
        assert!(
            err.is_err(),
            "negative price should violate CHECK constraint"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn test_product_qty_negative_rejected(pool: PgPool) {
        let seller_id = insert_farmer(&pool, "Alice").await;
        let err = sqlx::query(
            "INSERT INTO products (seller_id, title, price_kes, quantity_avail)
             VALUES ($1, 'Maize', 500, -1)",
        )
        .bind(seller_id)
        .execute(&pool)
        .await;
        assert!(
            err.is_err(),
            "negative quantity should violate CHECK constraint"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn test_product_invalid_status_rejected(pool: PgPool) {
        let seller_id = insert_farmer(&pool, "Alice").await;
        let err = sqlx::query(
            "INSERT INTO products (seller_id, title, price_kes, quantity_avail, status)
             VALUES ($1, 'Maize', 500, 10, 'available')",
        )
        .bind(seller_id)
        .execute(&pool)
        .await;
        assert!(
            err.is_err(),
            "'available' is not in the status CHECK constraint"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn test_soft_delete_hides_product(pool: PgPool) {
        let seller_id = insert_farmer(&pool, "Alice").await;
        let product_id = insert_product(&pool, seller_id, "Beans", dec!(200.00), dec!(50.0)).await;

        sqlx::query("UPDATE products SET status = 'deleted' WHERE id = $1")
            .bind(product_id)
            .execute(&pool)
            .await
            .unwrap();

        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM products WHERE status = 'active'")
                .fetch_one(&pool)
                .await
                .unwrap();

        assert_eq!(
            count, 0,
            "deleted product must not appear in active listings"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn test_product_list_filters_by_seller(pool: PgPool) {
        let alice = insert_farmer(&pool, "Alice").await;
        let bob = insert_farmer(&pool, "Bob").await;
        insert_product(&pool, alice, "Maize", dec!(500.00), dec!(10.0)).await;
        insert_product(&pool, alice, "Beans", dec!(200.00), dec!(20.0)).await;
        insert_product(&pool, bob, "Wheat", dec!(300.00), dec!(30.0)).await;

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM products WHERE seller_id = $1 AND status != 'deleted'",
        )
        .bind(alice)
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(count, 2);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn test_product_list_filters_by_category(pool: PgPool) {
        let seller_id = insert_farmer(&pool, "Alice").await;
        sqlx::query(
            "INSERT INTO products (seller_id, title, price_kes, quantity_avail, category)
             VALUES ($1, 'Maize', 500, 10, 'grains'),
                    ($1, 'Beans', 200, 20, 'legumes')",
        )
        .bind(seller_id)
        .execute(&pool)
        .await
        .unwrap();

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM products WHERE category = 'grains' AND status = 'active'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(count, 1);
    }

    // ── Order tests ───────────────────────────────────────────────────────────

    #[sqlx::test(migrations = "./migrations")]
    async fn test_create_order_decrements_quantity(pool: PgPool) {
        let seller = insert_farmer(&pool, "Alice").await;
        let buyer = insert_farmer(&pool, "Bob").await;
        let product_id = insert_product(&pool, seller, "Maize", dec!(500.00), dec!(100.0)).await;

        let rows = sqlx::query(
            "UPDATE products SET quantity_avail = quantity_avail - $2
             WHERE id = $1 AND quantity_avail >= $2 AND status = 'active'",
        )
        .bind(product_id)
        .bind(dec!(30.0))
        .execute(&pool)
        .await
        .unwrap()
        .rows_affected();

        assert_eq!(rows, 1, "exactly one row should be updated");

        let remaining: Decimal =
            sqlx::query_scalar("SELECT quantity_avail FROM products WHERE id = $1")
                .bind(product_id)
                .fetch_one(&pool)
                .await
                .unwrap();

        assert_eq!(remaining, dec!(70.0));
        let _ = buyer;
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn test_create_order_oversell_guard(pool: PgPool) {
        let seller = insert_farmer(&pool, "Alice").await;
        let product_id = insert_product(&pool, seller, "Maize", dec!(500.00), dec!(10.0)).await;

        let rows = sqlx::query(
            "UPDATE products SET quantity_avail = quantity_avail - $2
             WHERE id = $1 AND quantity_avail >= $2 AND status = 'active'",
        )
        .bind(product_id)
        .bind(dec!(11.0))
        .execute(&pool)
        .await
        .unwrap()
        .rows_affected();

        assert_eq!(rows, 0, "over-sell guard must block the update");

        let qty: Decimal = sqlx::query_scalar("SELECT quantity_avail FROM products WHERE id = $1")
            .bind(product_id)
            .fetch_one(&pool)
            .await
            .unwrap();

        assert_eq!(qty, dec!(10.0), "quantity must be unchanged");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn test_cancel_order_restores_quantity(pool: PgPool) {
        let seller = insert_farmer(&pool, "Alice").await;
        let buyer = insert_farmer(&pool, "Bob").await;
        let product_id = insert_product(&pool, seller, "Beans", dec!(200.00), dec!(50.0)).await;

        // Simulate the stock decrement from create_order
        sqlx::query(
            "UPDATE products SET quantity_avail = quantity_avail - $2
             WHERE id = $1 AND quantity_avail >= $2 AND status = 'active'",
        )
        .bind(product_id)
        .bind(dec!(20.0))
        .execute(&pool)
        .await
        .unwrap();

        let order_id =
            insert_order(&pool, product_id, seller, buyer, dec!(20.0), dec!(200.00)).await;

        // Cancel atomically
        let mut tx = pool.begin().await.unwrap();
        sqlx::query("UPDATE orders SET status = 'cancelled' WHERE id = $1")
            .bind(order_id)
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query("UPDATE products SET quantity_avail = quantity_avail + $2 WHERE id = $1")
            .bind(product_id)
            .bind(dec!(20.0))
            .execute(&mut *tx)
            .await
            .unwrap();
        tx.commit().await.unwrap();

        let qty: Decimal = sqlx::query_scalar("SELECT quantity_avail FROM products WHERE id = $1")
            .bind(product_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(qty, dec!(50.0), "quantity must be fully restored");

        let status: String = sqlx::query_scalar("SELECT status FROM orders WHERE id = $1")
            .bind(order_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(status, "cancelled");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn test_order_invalid_status_rejected(pool: PgPool) {
        let seller = insert_farmer(&pool, "Alice").await;
        let buyer = insert_farmer(&pool, "Bob").await;
        let product_id = insert_product(&pool, seller, "Maize", dec!(500.00), dec!(10.0)).await;
        let order_id =
            insert_order(&pool, product_id, seller, buyer, dec!(5.0), dec!(500.00)).await;

        let err = sqlx::query("UPDATE orders SET status = 'shipped' WHERE id = $1")
            .bind(order_id)
            .execute(&pool)
            .await;

        assert!(err.is_err(), "'shipped' is not a valid order status");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn test_order_full_delivery_status_chain(pool: PgPool) {
        let seller = insert_farmer(&pool, "Alice").await;
        let buyer = insert_farmer(&pool, "Bob").await;
        let product_id = insert_product(&pool, seller, "Maize", dec!(500.00), dec!(10.0)).await;
        let order_id =
            insert_order(&pool, product_id, seller, buyer, dec!(5.0), dec!(500.00)).await;

        for status in ["paid", "processing", "in_transit", "delivered", "confirmed"] {
            sqlx::query("UPDATE orders SET status = $2 WHERE id = $1")
                .bind(order_id)
                .bind(status)
                .execute(&pool)
                .await
                .unwrap();

            let current: String = sqlx::query_scalar("SELECT status FROM orders WHERE id = $1")
                .bind(order_id)
                .fetch_one(&pool)
                .await
                .unwrap();

            assert_eq!(current, status, "failed at step '{}'", status);
        }
    }

    // ── Payment tests ─────────────────────────────────────────────────────────

    #[sqlx::test(migrations = "./migrations")]
    async fn test_confirm_payment_settles_order(pool: PgPool) {
        let seller = insert_farmer(&pool, "Alice").await;
        let buyer = insert_farmer(&pool, "Bob").await;
        let product_id = insert_product(&pool, seller, "Maize", dec!(500.00), dec!(10.0)).await;
        let order_id =
            insert_order(&pool, product_id, seller, buyer, dec!(1.0), dec!(500.00)).await;
        let payment_id = insert_payment(&pool, order_id, 3333).await;

        let preimage_bytes = [42u8; 32];
        let preimage_hex = hex::encode(preimage_bytes);
        let payment_hash = hex::encode(Sha256::digest(preimage_bytes));

        sqlx::query(
            "UPDATE payments
             SET status = 'settled', preimage = $2, payment_hash = $3, settled_at = NOW()
             WHERE id = $1",
        )
        .bind(payment_id)
        .bind(&preimage_hex)
        .bind(&payment_hash)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "UPDATE orders SET status = 'paid' WHERE id = $1 AND status = 'pending_payment'",
        )
        .bind(order_id)
        .execute(&pool)
        .await
        .unwrap();

        let pay_status: String = sqlx::query_scalar("SELECT status FROM payments WHERE id = $1")
            .bind(payment_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(pay_status, "settled");

        let order_status: String = sqlx::query_scalar("SELECT status FROM orders WHERE id = $1")
            .bind(order_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(order_status, "paid");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn test_payment_hash_uniqueness_enforced(pool: PgPool) {
        let seller = insert_farmer(&pool, "Alice").await;
        let buyer = insert_farmer(&pool, "Bob").await;

        // Two separate products and orders — one payment per order — so we
        // don't hit the partial unique index on (order_id) WHERE status='pending'.
        // This test is only checking that the payment_hash UNIQUE constraint fires.
        let product1 = insert_product(&pool, seller, "Maize", dec!(500.00), dec!(10.0)).await;
        let product2 = insert_product(&pool, seller, "Wheat", dec!(400.00), dec!(5.0)).await;
        let order1 = insert_order(&pool, product1, seller, buyer, dec!(2.0), dec!(500.00)).await;
        let order2 = insert_order(&pool, product2, seller, buyer, dec!(1.0), dec!(400.00)).await;

        let p1 = insert_payment(&pool, order1, 3333).await;
        let p2 = insert_payment(&pool, order2, 4444).await;

        let hash = "a".repeat(63) + "b"; // 64-char hex string

        // Set the same payment_hash on both payments — second one must fail
        sqlx::query("UPDATE payments SET payment_hash = $2 WHERE id = $1")
            .bind(p1)
            .bind(&hash)
            .execute(&pool)
            .await
            .unwrap();

        let err = sqlx::query("UPDATE payments SET payment_hash = $2 WHERE id = $1")
            .bind(p2)
            .bind(&hash)
            .execute(&pool)
            .await;

        assert!(
            err.is_err(),
            "duplicate payment_hash must violate UNIQUE constraint"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn test_payment_invalid_status_rejected(pool: PgPool) {
        let seller = insert_farmer(&pool, "Alice").await;
        let buyer = insert_farmer(&pool, "Bob").await;
        let product_id = insert_product(&pool, seller, "Maize", dec!(500.00), dec!(10.0)).await;
        let order_id =
            insert_order(&pool, product_id, seller, buyer, dec!(1.0), dec!(500.00)).await;
        let payment_id = insert_payment(&pool, order_id, 1000).await;

        let err = sqlx::query("UPDATE payments SET status = 'confirmed' WHERE id = $1")
            .bind(payment_id)
            .execute(&pool)
            .await;

        assert!(err.is_err(), "'confirmed' is not a valid payment status");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn test_order_event_log_records_transition(pool: PgPool) {
        let seller = insert_farmer(&pool, "Alice").await;
        let buyer = insert_farmer(&pool, "Bob").await;
        let product_id = insert_product(&pool, seller, "Maize", dec!(500.00), dec!(10.0)).await;
        let order_id =
            insert_order(&pool, product_id, seller, buyer, dec!(1.0), dec!(500.00)).await;

        sqlx::query(
            "INSERT INTO order_events (order_id, actor_id, event_type, metadata)
             VALUES ($1, $2, 'order_created', '{}')",
        )
        .bind(order_id)
        .bind(buyer)
        .execute(&pool)
        .await
        .unwrap();

        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM order_events WHERE order_id = $1")
                .bind(order_id)
                .fetch_one(&pool)
                .await
                .unwrap();

        assert_eq!(count, 1);
    }
}
