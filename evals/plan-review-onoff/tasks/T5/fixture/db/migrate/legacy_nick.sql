-- one-off script that populated nick from the old accounts table
UPDATE users SET nick = (SELECT login FROM accounts WHERE accounts.id = users.id);
