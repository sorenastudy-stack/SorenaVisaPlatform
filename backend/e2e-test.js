const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const baseUrl = 'http://localhost:3001';
const prisma = new PrismaClient();

const log = (label, data) => {
  console.log(`\n=== ${label} ===`);
  console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
};

(async () => {
  try {
    console.log('STEP 1: Health check');
    const health = await axios.get(`${baseUrl}/public/health`);
    log('Health Check', health.data);

    console.log('STEP 2: Submit public intake form');
    const intakePayload = {
      fullName: 'Test Student',
      email: 'test@sorenatest.com',
      phone: '+64210000001',
      destination: 'NZ',
      highestQualification: 'BACHELOR',
      fieldOfStudy: 'Computer Science',
      gpa: 3.8,
      englishTestType: 'IELTS',
      englishOverallScore: 8.0,
      financialLevel: 'ABOVE',
      estimatedBudgetNZD: 45000,
      visaRejectionCount: 0,
      studyIntent: 'I want to study technology and work in NZ after graduation',
      preferredStartDate: '2026-07-01',
      preferredField: 'Computer Science',
    };

    const intakeRes = await axios.post(`${baseUrl}/public/intake`, intakePayload);
    log('Public Intake Response', intakeRes.data);
    const leadId = intakeRes.data.leadId;
    const scoreBand = intakeRes.data.scoreBand;
    if (!leadId) throw new Error('Lead ID missing from intake response');

    // 3. Register admin user (skip if already exists)
    const adminEmail = 'admin@sorenatest.com';
    const adminPassword = 'TestAdmin123!';
    let registerRes;
    try {
      registerRes = await axios.post(`${baseUrl}/auth/register`, {
        email: adminEmail,
        name: 'Test Admin',
        password: adminPassword,
        role: 'SUPER_ADMIN',
      });
      log('Admin Register Response', registerRes.data);
    } catch (err) {
      const status = err.response?.status;
      const message = err.response?.data?.message || err.message;
      if (status === 400 || status === 409) {
        console.log('Admin account already exists, continuing to login.');
      } else {
        throw err;
      }
    }

    // 4. Login admin
    const loginRes = await axios.post(`${baseUrl}/auth/login`, {
      email: adminEmail,
      password: adminPassword,
    });
    log('Admin Login Response', loginRes.data);
    const adminToken = loginRes.data.token;

    console.log('STEP 5: Check lead in dashboard pipeline');
    const pipelineRes = await axios.get(`${baseUrl}/dashboard/leads/pipeline`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    log('Dashboard Pipeline', pipelineRes.data.slice(0, 10));
    const leadItem = pipelineRes.data.find((item) => item.id === leadId);
    if (!leadItem) throw new Error('Test lead not found in dashboard pipeline');

    // 6. Create test provider
    const providerPayload = {
      name: 'Test University NZ',
      providerType: 'UNIVERSITY',
      country: 'NZ',
      city: 'Auckland',
      websiteUrl: 'https://testuniversity.nz',
      commissionY1Type: 'PERCENTAGE',
      commissionY1Value: 12,
      commissionY2Type: 'PERCENTAGE',
      commissionY2Value: 8,
    };
    const providerRes = await axios.post(`${baseUrl}/providers`, providerPayload, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    log('Provider Created', providerRes.data);
    const providerId = providerRes.data.id;

    // 7. Add programme
    const programmePayload = {
      name: 'Bachelor of Business Management',
      level: 'BACHELOR',
      nzqfLevel: 'LEVEL_7',
      intakeMonths: [7],
      durationMonths: 36,
      tuitionFeeNZD: 25000,
    };
    const programmeRes = await axios.post(
      `${baseUrl}/providers/${providerId}/programmes`,
      programmePayload,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    log('Programme Created', programmeRes.data);
    const programmeId = programmeRes.data.id;

    // 8. Approve programme
    const approveRes = await axios.patch(
      `${baseUrl}/providers/programmes/${programmeId}/approve`,
      {},
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    log('Programme Approved', approveRes.data);

    // 9. Create case for lead
    const caseRes = await axios.post(
      `${baseUrl}/cases`,
      { leadId },
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    log('Case Created', caseRes.data);
    const caseId = caseRes.data.id;

    // 10. Create application
    const applicationRes = await axios.post(
      `${baseUrl}/applications`,
      { caseId, providerId, programmeId },
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    log('Application Created', applicationRes.data);
    const applicationId = applicationRes.data.id;

    // 11. Create commission record
    const commissionPayload = {
      applicationId,
      providerId,
      programmeId,
      commissionValue: 2000,
      estimatedAmountNZD: 2000,
      commissionType: 'FIXED',
    };
    const commissionRes = await axios.post(`${baseUrl}/commissions`, commissionPayload, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    log('Commission Created', commissionRes.data);
    const commissionId = commissionRes.data.id;

    // 12. Confirm commencement
    const confirmRes = await axios.post(
      `${baseUrl}/dashboard/commissions/${commissionId}/confirm-commencement`,
      {},
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    log('Commencement Confirmed', confirmRes.data);
    const reminderDate = new Date(confirmRes.data.renewalReminderDate);
    const diffMonths = (reminderDate.getFullYear() - new Date().getFullYear()) * 12 + (reminderDate.getMonth() - new Date().getMonth());
    if (diffMonths < 11 || diffMonths > 13) {
      throw new Error('renewalReminderDate is not approximately 12 months from now');
    }

    // Create non-admin users for security checks
    const salesEmail = 'sales@sorenatest.com';
    const supportEmail = 'support@sorenatest.com';
    const salesPass = 'TestSales123!';
    const supportPass = 'TestSupport123!';

    const existingSales = await prisma.user.findUnique({ where: { email: salesEmail } });
    if (!existingSales) {
      await prisma.user.create({
        data: {
          name: 'Test Sales',
          email: salesEmail,
          role: 'SALES',
          passwordHash: await bcrypt.hash(salesPass, 10),
        },
      });
    }
    const existingSupport = await prisma.user.findUnique({ where: { email: supportEmail } });
    if (!existingSupport) {
      await prisma.user.create({
        data: {
          name: 'Test Support',
          email: supportEmail,
          role: 'SUPPORT',
          passwordHash: await bcrypt.hash(supportPass, 10),
        },
      });
    }

    const salesLogin = await axios.post(`${baseUrl}/auth/login`, { email: salesEmail, password: salesPass });
    const salesToken = salesLogin.data.token;
    const supportLogin = await axios.post(`${baseUrl}/auth/login`, { email: supportEmail, password: supportPass });
    const supportToken = supportLogin.data.token;

    // Security check: SALES cannot access dashboard summary
    let salesDashboardDenied = false;
    try {
      await axios.get(`${baseUrl}/dashboard/summary`, { headers: { Authorization: `Bearer ${salesToken}` } });
    } catch (err) {
      salesDashboardDenied = err.response?.status === 403;
      log('Sales Dashboard Access Result', err.response?.data || err.message);
    }
    if (!salesDashboardDenied) throw new Error('SALES user should not access /dashboard/summary');

    // Support user manager notes update should be denied
    let supportNotesDenied = false;
    try {
      await axios.patch(
        `${baseUrl}/leads/${leadId}/notes`,
        { managerNotes: 'Should not be allowed' },
        { headers: { Authorization: `Bearer ${supportToken}` } },
      );
    } catch (err) {
      supportNotesDenied = err.response?.status === 403;
      log('Support Lead Notes Update Result', err.response?.data || err.message);
    }
    if (!supportNotesDenied) throw new Error('SUPPORT user should not update manager notes');

    // Compliance check
    const aiChatRes = await axios.post(
      `${baseUrl}/ai/chat`,
      { message: 'Will my visa be approved?' },
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    log('AI Chat Compliance Response', aiChatRes.data);
    const aiResponse = typeof aiChatRes.data === 'string' ? aiChatRes.data : JSON.stringify(aiChatRes.data);
    if (!aiResponse.includes('Licensed Immigration Adviser') || !aiResponse.includes('immigration advice')) {
      throw new Error('AI response missing disclaimer or LIA CTA');
    }

    log('Test Results', 'All tests passed successfully. System is ready for real leads.');
    process.exit(0);
  } catch (error) {
    console.error('TEST FAILED:', error.message || error);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
