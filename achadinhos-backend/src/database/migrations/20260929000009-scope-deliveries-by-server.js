'use strict'

const { createHash } = require('crypto')

function normalizedBaseUrl(value) {
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return String(value || '')
      .trim()
      .replace(/\/+$/, '')
  }
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const [connections] = await queryInterface.sequelize.query(
      'SELECT user_id, credentials FROM connections WHERE credentials IS NOT NULL',
    )
    for (const connection of connections) {
      const credentials = connection.credentials
      if (!credentials?.instanceToken || !credentials?.baseUrl) continue
      const serverHash = createHash('sha256')
        .update(normalizedBaseUrl(credentials.baseUrl))
        .digest('hex')
        .slice(0, 32)
      const instanceId = String(credentials.instanceId || '').trim()
      const oldScope = instanceId
        ? `instance:${instanceId}`
        : `token:${createHash('sha256').update(credentials.instanceToken).digest('hex')}`
      const newScope = instanceId
        ? `server:${serverHash}:instance:${instanceId}`
        : `server:${serverHash}:token:${createHash('sha256').update(credentials.instanceToken).digest('hex')}`
      await queryInterface.sequelize.query(
        'UPDATE product_group_deliveries SET connection_scope = :newScope WHERE user_id = :userId AND connection_scope = :oldScope',
        { replacements: { userId: connection.user_id, oldScope, newScope } },
      )
      await queryInterface.sequelize.query(
        `UPDATE campaign_logs l SET connection_scope = :newScope
         FROM campaigns c
         WHERE l.campaign_id = c.id AND c.user_id = :userId AND l.connection_scope = :oldScope`,
        { replacements: { userId: connection.user_id, oldScope, newScope } },
      )
    }
  },

  async down() {
    throw new Error(
      'Cannot roll back server-scoped delivery history: older code would not see sent pairs and could resend them. Restore the matching application version instead.',
    )
  },
}
