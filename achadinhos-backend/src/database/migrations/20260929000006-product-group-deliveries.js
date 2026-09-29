'use strict'

const { createHash } = require('crypto')

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize
    await queryInterface.addColumn('campaign_logs', 'connection_scope', {
      type: DataTypes.STRING(160),
      allowNull: true,
    })
    await queryInterface.addColumn('campaign_logs', 'offer_source', {
      type: DataTypes.STRING(40),
      allowNull: true,
    })
    await queryInterface.addColumn('campaign_logs', 'offer_identity', {
      type: DataTypes.STRING(255),
      allowNull: true,
    })
    await queryInterface.createTable('product_group_deliveries', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      connection_scope: { type: DataTypes.STRING(160), allowNull: false },
      offer_identity: { type: DataTypes.STRING(255), allowNull: false },
      offer_source: { type: DataTypes.STRING(40), allowNull: true },
      offer_product_id: { type: DataTypes.STRING(60), allowNull: true },
      offer_url: { type: DataTypes.TEXT, allowNull: false },
      offer_title: { type: DataTypes.STRING, allowNull: false },
      group_id: { type: DataTypes.STRING, allowNull: false },
      group_name: { type: DataTypes.STRING, allowNull: false },
      campaign_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'campaigns', key: 'id' },
        onDelete: 'SET NULL',
      },
      status: { type: DataTypes.ENUM('SENDING', 'SENT'), allowNull: false },
      message_id: { type: DataTypes.STRING, allowNull: true },
      sent_at: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    })
    await queryInterface.addIndex(
      'product_group_deliveries',
      ['user_id', 'connection_scope', 'offer_identity', 'group_id'],
      { unique: true, name: 'product_group_delivery_pair_unique' },
    )
    await queryInterface.addIndex('product_group_deliveries', ['user_id', 'status'], {
      name: 'product_group_deliveries_user_status',
    })

    // Reconcile successful history into the new source-aware ledger. Historical
    // rows are scoped to the connection attached at migration time.
    const [rows] = await queryInterface.sequelize.query(`
      SELECT l.id, l.group_id, l.group_name, l.offer_title, l.offer_product_id,
             l.offer_url, l.message_id, l.sent_at, c.id AS campaign_id,
             c.user_id, c.offers, n.uuid AS connection_uuid, n.credentials
      FROM campaign_logs l
      JOIN campaigns c ON c.id = l.campaign_id
      LEFT JOIN connections n ON n.user_id = c.user_id
      WHERE l.success = TRUE
    `)
    for (const row of rows) {
      const credentials = row.credentials || null
      if (!credentials?.instanceToken) continue
      const instanceId = String(credentials.instanceId || '').trim()
      const scope = instanceId
        ? `instance:${instanceId}`
        : `token:${createHash('sha256').update(credentials.instanceToken).digest('hex')}`
      const offers = Array.isArray(row.offers) ? row.offers : []
      const matched = offers.find(
        (offer) =>
          (row.offer_url && offer.affiliateUrl === row.offer_url) ||
          (row.offer_product_id && offer.productId === row.offer_product_id),
      )
      const source = matched?.source?.trim()?.toLowerCase() || null
      const productId = row.offer_product_id || matched?.productId || null
      const canonical = productId
        ? JSON.stringify(['product', source || 'generic', String(productId).trim()])
        : JSON.stringify(['url', String(row.offer_url || '').trim()])
      const identity = createHash('sha256').update(canonical).digest('hex')

      await queryInterface.sequelize.query(
        `UPDATE campaign_logs
         SET connection_scope = :scope, offer_source = :source, offer_identity = :identity
         WHERE id = :id`,
        { replacements: { id: row.id, scope, source, identity } },
      )
      await queryInterface.sequelize.query(
        `INSERT INTO product_group_deliveries
          (user_id, connection_scope, offer_identity, offer_source, offer_product_id,
           offer_url, offer_title, group_id, group_name, campaign_id, status,
           message_id, sent_at, created_at, updated_at)
         VALUES
          (:userId, :scope, :identity, :source, :productId, :url, :title,
           :groupId, :groupName, :campaignId, 'SENT', :messageId, :sentAt, NOW(), NOW())
         ON CONFLICT (user_id, connection_scope, offer_identity, group_id)
         DO UPDATE SET status = 'SENT', sent_at = EXCLUDED.sent_at,
                       message_id = EXCLUDED.message_id, campaign_id = EXCLUDED.campaign_id,
                       group_name = EXCLUDED.group_name, updated_at = NOW()`,
        {
          replacements: {
            userId: row.user_id,
            scope,
            identity,
            source,
            productId,
            url: row.offer_url || matched?.affiliateUrl || '',
            title: row.offer_title,
            groupId: row.group_id,
            groupName: row.group_name,
            campaignId: row.campaign_id,
            messageId: row.message_id,
            sentAt: row.sent_at,
          },
        },
      )
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('product_group_deliveries')
    await queryInterface.removeColumn('campaign_logs', 'offer_identity')
    await queryInterface.removeColumn('campaign_logs', 'offer_source')
    await queryInterface.removeColumn('campaign_logs', 'connection_scope')
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_product_group_deliveries_status";',
    )
  },
}
