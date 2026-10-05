'use strict'
module.exports = {
  async up(q, S) {
    await q.addColumn('ad_projects', 'revision', { type: S.INTEGER, allowNull: false, defaultValue: 0 })
    await q.createTable('ad_studio_records', {
      id: { type: S.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: { type: S.INTEGER, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      project_id: { type: S.INTEGER, allowNull: true, references: { model: 'ad_projects', key: 'id' }, onDelete: 'CASCADE' },
      kind: { type: S.STRING(20), allowNull: false },
      key: { type: S.STRING(100), allowNull: false },
      payload: { type: S.JSONB, allowNull: false },
      revision: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: S.DATE, allowNull: false },
      updated_at: { type: S.DATE, allowNull: false },
    })
    await q.addIndex('ad_studio_records', ['user_id', 'kind', 'key'], { unique: true })
    await q.addIndex('ad_studio_records', ['project_id'])
  },
  async down(q) {
    await q.dropTable('ad_studio_records')
    await q.removeColumn('ad_projects', 'revision')
  },
}
