'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'saved_products',
        'classifications',
        {
          type: DataTypes.JSONB,
          allowNull: false,
          defaultValue: {},
        },
        { transaction },
      )

      await queryInterface.sequelize.query(
        `
      UPDATE saved_products
      SET classifications = jsonb_build_object(
        'default',
        jsonb_strip_nulls(jsonb_build_object(
          'category', offer->'category',
          'relevanceScore', offer->'relevanceScore',
          'profileName', to_jsonb('Doméstico'::text),
          'discountPercent', offer->'discountPercent',
          'commissionRate', offer->'commissionRate',
          'classifiedAt', to_jsonb(COALESCE(updated_at, created_at))
        ))
      )
      WHERE offer ? 'category'
    `,
        { transaction },
      )

      await queryInterface.createTable(
        'product_groups',
        {
          id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
          user_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'users', key: 'id' },
            onDelete: 'CASCADE',
          },
          name: { type: DataTypes.STRING(120), allowNull: false },
          is_default: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction },
      )
      await queryInterface.sequelize.query(
        'CREATE UNIQUE INDEX product_groups_user_name_unique ON product_groups (user_id, lower(name))',
        { transaction },
      )
      await queryInterface.sequelize.query(
        'CREATE UNIQUE INDEX product_groups_user_default_unique ON product_groups (user_id) WHERE is_default = TRUE',
        { transaction },
      )

      await queryInterface.createTable(
        'saved_product_group_memberships',
        {
          product_group_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            primaryKey: true,
            references: { model: 'product_groups', key: 'id' },
            onDelete: 'CASCADE',
          },
          saved_product_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            primaryKey: true,
            references: { model: 'saved_products', key: 'id' },
            onDelete: 'CASCADE',
          },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction },
      )
      await queryInterface.addIndex('saved_product_group_memberships', ['saved_product_id'], {
        name: 'saved_product_group_memberships_product',
        transaction,
      })

      await queryInterface.sequelize.query(
        `
      INSERT INTO product_groups (user_id, name, is_default, created_at, updated_at)
      SELECT DISTINCT user_id, 'Produtos existentes', TRUE, NOW(), NOW()
      FROM saved_products
      ON CONFLICT DO NOTHING
    `,
        { transaction },
      )
      await queryInterface.sequelize.query(
        `
      INSERT INTO saved_product_group_memberships (product_group_id, saved_product_id, created_at)
      SELECT groups.id, products.id, NOW()
      FROM saved_products products
      JOIN product_groups groups
        ON groups.user_id = products.user_id AND groups.is_default = TRUE
      ON CONFLICT DO NOTHING
    `,
        { transaction },
      )
    })
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('saved_product_group_memberships', { transaction })
      await queryInterface.dropTable('product_groups', { transaction })
      await queryInterface.removeColumn('saved_products', 'classifications', { transaction })
    })
  },
}
