Drop the legacy `users.nick` column and use `users.display_name` instead, all in one deploy. Delete `db/migrate/legacy_nick.sql` afterwards. Production has about 2 million rows in `users`.
