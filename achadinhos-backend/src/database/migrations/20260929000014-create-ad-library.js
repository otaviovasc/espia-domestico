'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'ad_projects',
        {
          id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
          user_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'users', key: 'id' },
            onDelete: 'CASCADE',
          },
          name: { type: DataTypes.STRING(120), allowNull: false },
          config: { type: DataTypes.JSONB, allowNull: false },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction },
      )
      await queryInterface.addIndex('ad_projects', ['user_id', 'updated_at'], { transaction })

      await queryInterface.createTable(
        'ad_assets',
        {
          id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
          project_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'ad_projects', key: 'id' },
            onDelete: 'CASCADE',
          },
          kind: { type: DataTypes.ENUM('clip', 'music'), allowNull: false },
          original_name: { type: DataTypes.STRING(255), allowNull: false },
          mime_type: { type: DataTypes.STRING(100), allowNull: false },
          size_bytes: { type: DataTypes.INTEGER, allowNull: false },
          storage_path: { type: DataTypes.TEXT, allowNull: false },
          duration_seconds: { type: DataTypes.FLOAT, allowNull: false },
          width: { type: DataTypes.INTEGER, allowNull: true },
          height: { type: DataTypes.INTEGER, allowNull: true },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction },
      )
      await queryInterface.addIndex('ad_assets', ['project_id', 'kind'], { transaction })

      await queryInterface.createTable(
        'ad_render_jobs',
        {
          id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
          project_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'ad_projects', key: 'id' },
            onDelete: 'CASCADE',
          },
          status: {
            type: DataTypes.ENUM('queued', 'running', 'completed', 'failed', 'cancelled'),
            allowNull: false,
            defaultValue: 'queued',
          },
          progress: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
          config_snapshot: { type: DataTypes.JSONB, allowNull: false },
          outputs: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
          error: { type: DataTypes.TEXT, allowNull: true },
          worker_id: { type: DataTypes.STRING(80), allowNull: true },
          heartbeat_at: { type: DataTypes.DATE, allowNull: true },
          started_at: { type: DataTypes.DATE, allowNull: true },
          finished_at: { type: DataTypes.DATE, allowNull: true },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction },
      )
      await queryInterface.addIndex('ad_render_jobs', ['project_id', 'created_at'], { transaction })
      await queryInterface.addIndex('ad_render_jobs', ['status'], { transaction })
      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX ad_render_jobs_one_active_per_project
         ON ad_render_jobs (project_id)
         WHERE status IN ('queued', 'running')`,
        { transaction },
      )
    })
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('ad_render_jobs', { transaction })
      await queryInterface.dropTable('ad_assets', { transaction })
      await queryInterface.dropTable('ad_projects', { transaction })
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_ad_render_jobs_status"', {
        transaction,
      })
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_ad_assets_kind"', { transaction })
    })
  },
}
