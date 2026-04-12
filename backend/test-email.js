#!/usr/bin/env node

require('dotenv').config();
const nodemailer = require('nodemailer');

const testEmail = async () => {
  console.log('📧 Testing SMTP Configuration...\n');

  // Read SMTP settings from .env
  const smtpConfig = {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  };

  console.log('SMTP Configuration:');
  console.log(`  Host: ${smtpConfig.host}`);
  console.log(`  Port: ${smtpConfig.port}`);
  console.log(`  Secure (SSL): ${smtpConfig.secure}`);
  console.log(`  User: ${smtpConfig.auth.user}`);
  console.log();

  // Validate configuration
  if (!smtpConfig.host || !smtpConfig.auth.user || !smtpConfig.auth.pass) {
    console.error('❌ Error: SMTP configuration is incomplete.');
    console.error('   Please ensure SMTP_HOST, SMTP_USER, and SMTP_PASS are set in .env');
    process.exit(1);
  }

  try {
    // Create transporter
    const transporter = nodemailer.createTransport(smtpConfig);

    // Verify connection
    console.log('🔐 Verifying SMTP connection...');
    await transporter.verify();
    console.log('✅ SMTP connection verified successfully!\n');

    // Send test email
    console.log('📤 Sending test email...');
    const result = await transporter.sendMail({
      from: process.env.FROM_EMAIL || smtpConfig.auth.user,
      to: 'sorenastudy@gmail.com',
      subject: 'Sorena Email Test',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 5px; padding: 20px;">
          <h2 style="color: #0a2342;">Email Connection Test</h2>
          <p>Email connection is working.</p>
          <p style="color: #666; font-size: 12px; margin-top: 20px;">
            Sent from: ${new Date().toISOString()}<br>
            From Address: ${process.env.FROM_EMAIL || smtpConfig.auth.user}
          </p>
        </div>
      `,
      text: 'Email connection is working.',
    });

    console.log('✅ Test email sent successfully!');
    console.log(`   Message ID: ${result.messageId}`);
    console.log(`   Response: ${result.response}\n`);
    console.log('📧 Email details:');
    console.log(`   To: sorenastudy@gmail.com`);
    console.log(`   Subject: Sorena Email Test`);
    console.log(`   From: ${process.env.FROM_EMAIL || smtpConfig.auth.user}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error sending test email:');
    console.error(`   ${error.message}`);
    if (error.code) {
      console.error(`   Error Code: ${error.code}`);
    }
    console.error(`\n⚠️  Troubleshooting tips:`);
    console.error('   1. Verify SMTP_HOST is correct and accessible');
    console.error('   2. Verify SMTP_USER and SMTP_PASS are correct');
    console.error('   3. Check if your SMTP provider requires specific firewall rules');
    console.error('   4. For Gmail, use an app-specific password, not your account password');
    process.exit(1);
  }
};

// Run the test
testEmail();
