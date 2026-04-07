import { Injectable } from '@nestjs/common';
import * as docusign from 'docusign-esign';

@Injectable()
export class DocuSignService {
  private apiClient: docusign.ApiClient;
  private accountId: string;

  constructor() {
    const accessToken = process.env.DOCUSIGN_ACCESS_TOKEN;
    const baseUrl = process.env.DOCUSIGN_BASE_URL;
    this.accountId = process.env.DOCUSIGN_ACCOUNT_ID || '';

    if (!accessToken || !baseUrl || !this.accountId) {
      throw new Error('DocuSign environment variables are required');
    }

    this.apiClient = new docusign.ApiClient();
    this.apiClient.setBasePath(baseUrl);
    this.apiClient.addDefaultHeader('Authorization', `Bearer ${accessToken}`);
  }

  async createEnvelope(
    caseId: string,
    signerEmail: string,
    signerName: string,
  ): Promise<string> {
    const envelopesApi = new docusign.EnvelopesApi(this.apiClient);

    const envelopeDefinition = new docusign.EnvelopeDefinition();
    envelopeDefinition.emailSubject = 'Please sign this contract';
    envelopeDefinition.emailBlurb = 'Please review and sign the attached contract.';
    envelopeDefinition.status = 'sent';

    // Add document (placeholder - in real implementation, you'd upload actual contract)
    const document = new docusign.Document();
    document.documentBase64 = Buffer.from('Contract content here').toString('base64');
    document.name = 'Contract.pdf';
    document.fileExtension = 'pdf';
    document.documentId = '1';
    envelopeDefinition.documents = [document];

    // Add signer
    const signer = new docusign.Signer();
    signer.email = signerEmail;
    signer.name = signerName;
    signer.recipientId = '1';
    signer.routingOrder = '1';

    // Add sign here tab
    const signHere = new docusign.SignHere();
    signHere.documentId = '1';
    signHere.pageNumber = '1';
    signHere.recipientId = '1';
    signHere.tabLabel = 'SignHereTab';
    signHere.xPosition = '100';
    signHere.yPosition = '150';

    signer.tabs = new docusign.Tabs();
    signer.tabs.signHereTabs = [signHere];

    const recipients = new docusign.Recipients();
    recipients.signers = [signer];
    envelopeDefinition.recipients = recipients;

    const results = await envelopesApi.createEnvelope(this.accountId, {
      envelopeDefinition,
    });

    return results.envelopeId;
  }

  async getSigningUrl(
    envelopeId: string,
    signerEmail: string,
    signerName: string,
    returnUrl: string,
  ): Promise<string> {
    const envelopesApi = new docusign.EnvelopesApi(this.apiClient);

    const recipientViewRequest = new docusign.RecipientViewRequest();
    recipientViewRequest.returnUrl = returnUrl;
    recipientViewRequest.authenticationMethod = 'none';
    recipientViewRequest.email = signerEmail;
    recipientViewRequest.userName = signerName;
    recipientViewRequest.clientUserId = '1';

    const results = await envelopesApi.createRecipientView(
      this.accountId,
      envelopeId,
      { recipientViewRequest },
    );

    return results.url;
  }

  async syncStatus(envelopeId: string): Promise<any> {
    const envelopesApi = new docusign.EnvelopesApi(this.apiClient);

    const envelope = await envelopesApi.getEnvelope(this.accountId, envelopeId);

    return {
      status: envelope.status,
      signedAt: envelope.completedDateTime,
      declinedAt: envelope.declinedDateTime,
      expiredAt: envelope.expiredDateTime,
      signedFileUrl: envelope.documents?.[0]?.uri,
      auditTrailUrl: envelope.certificateUri,
    };
  }
}
