package migrations

import "gorm.io/gorm"

func addHomepageLinks(tx *gorm.DB) error {
	return tx.Exec(`
 CREATE TABLE links (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(100) NOT NULL CHECK (length(trim(title)) > 0),
  description VARCHAR(300) NOT NULL DEFAULT '',
  url VARCHAR(2048) NOT NULL DEFAULT '',
  icon VARCHAR(24) NOT NULL CHECK (icon IN ('star','grid','layout','zap','link','code','book','globe')),
  color VARCHAR(16) NOT NULL CHECK (color IN ('blue','yellow','green','red')),
  visible BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT visible OR length(url) > 0),
  position BIGINT NOT NULL,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740991),
  request_id VARCHAR(80) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 );
 CREATE INDEX links_order_idx ON links(position, id);
 INSERT INTO links(title, description, icon, color, position, request_id) VALUES
 ('Featured Post','Test out my most advanced and newly published coding tutorials.','star','yellow',1,'seed-featured'),
 ('Code and Backend','Build RESTful APIs, scalable services, and database tuning with Go.','grid','blue',2,'seed-backend'),
 ('Frontend UI','Generate and engineer pixel-perfect Next.js web applications.','layout','green',3,'seed-frontend'),
 ('Real-time Thoughts','Read real-time insights, journals, and reflections on development life.','zap','red',4,'seed-thoughts');
 `).Error
}
