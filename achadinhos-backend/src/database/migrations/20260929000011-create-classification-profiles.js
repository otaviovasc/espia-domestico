'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'classification_profiles',
        {
          id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
          user_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'users', key: 'id' },
            onDelete: 'CASCADE',
          },
          name: { type: DataTypes.STRING(120), allowNull: false },
          niche_description: { type: DataTypes.TEXT, allowNull: false },
          relevance_instructions: { type: DataTypes.TEXT, allowNull: false },
          weights: { type: DataTypes.JSONB, allowNull: false },
          discount_cap: { type: DataTypes.FLOAT, allowNull: false },
          commission_cap: { type: DataTypes.FLOAT, allowNull: false },
          thresholds: { type: DataTypes.JSONB, allowNull: false },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction },
      )
      await queryInterface.addIndex('classification_profiles', ['user_id', 'created_at'], {
        name: 'classification_profiles_user_created_at',
        transaction,
      })
    })
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction((transaction) =>
      queryInterface.dropTable('classification_profiles', { transaction }),
    )
  },
}
