'use strict'

/** Database-backed state history also survives worker restarts and late errors. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(`
        CREATE TABLE smart_plan_events (
          id BIGSERIAL PRIMARY KEY,
          plan_id INTEGER NOT NULL REFERENCES smart_plans(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          previous_status TEXT,
          status TEXT NOT NULL,
          revision INTEGER NOT NULL,
          occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX smart_plan_events_owner_plan ON smart_plan_events(user_id, plan_id, id);
        CREATE FUNCTION record_smart_plan_event() RETURNS TRIGGER AS $$
        BEGIN
          IF TG_OP = 'INSERT' THEN
            INSERT INTO smart_plan_events(plan_id, user_id, previous_status, status, revision)
              VALUES (NEW.id, NEW.user_id, NULL, NEW.status::text, NEW.revision);
          ELSIF OLD.status IS DISTINCT FROM NEW.status OR OLD.revision IS DISTINCT FROM NEW.revision THEN
            INSERT INTO smart_plan_events(plan_id, user_id, previous_status, status, revision)
              VALUES (NEW.id, NEW.user_id, OLD.status::text, NEW.status::text, NEW.revision);
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER smart_plan_event AFTER INSERT OR UPDATE ON smart_plans
          FOR EACH ROW EXECUTE FUNCTION record_smart_plan_event();
      `, { transaction })
    })
  },
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(`
        DROP TRIGGER IF EXISTS smart_plan_event ON smart_plans;
        DROP FUNCTION IF EXISTS record_smart_plan_event();
        DROP TABLE IF EXISTS smart_plan_events;
      `, { transaction })
    })
  },
}
