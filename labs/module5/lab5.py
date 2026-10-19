"""Module 5 lab: build and inspect real SAML 2.0 messages for the PingFederate lab.

Uses the lab keys from ../lab4 (IdP signing key signed by the lab root CA).
Outputs text files that are rendered into the Module 5 document.
"""
import base64, datetime as dt, hashlib, os, secrets, textwrap, urllib.parse, zlib
from lxml import etree
from signxml import XMLSigner, XMLVerifier, InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

HERE = os.path.dirname(os.path.abspath(__file__))
L4 = os.path.join(HERE, '..', 'module4')
KEY = open(os.path.join(L4, 'idp-signing.key'), 'rb').read()
CERT = open(os.path.join(L4, 'idp-signing.crt'), 'rb').read()
CERT_B64 = ''.join(l for l in CERT.decode().splitlines() if '-----' not in l)

IDP_ENTITY = 'pingfed-lab-idp'                       # proposed SAML 2.0 Entity ID for your server
PF = 'https://pf.pingfed.lab:9031'                   # runtime base URL (after fixing localhost)
SP_ENTITY = 'https://sp.lab.local/saml'             # example partner SP
SP_ACS = 'https://sp.lab.local/saml/acs'
NOW = dt.datetime(2026, 9, 30, 10, 0, 0, tzinfo=dt.timezone.utc)
iso = lambda t: t.strftime('%Y-%m-%dT%H:%M:%SZ')
out = {}


def pretty(x):
    return etree.tostring(etree.fromstring(x.encode() if isinstance(x, str) else x), pretty_print=True).decode()


# ---------------------------------------------------------------- 1. AuthnRequest + HTTP-Redirect
req_id = '_' + secrets.token_hex(16)
authn = f'''<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
 ID="{req_id}" Version="2.0" IssueInstant="{iso(NOW)}" Destination="{PF}/idp/SSO.saml2"
 ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" AssertionConsumerServiceURL="{SP_ACS}">
  <saml:Issuer>{SP_ENTITY}</saml:Issuer>
  <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified" AllowCreate="true"/>
</samlp:AuthnRequest>'''
authn_min = etree.tostring(etree.fromstring(authn.encode())).decode()
deflated = zlib.compress(authn_min.encode())[2:-4]               # raw DEFLATE (no zlib header/checksum)
saml_request = base64.b64encode(deflated).decode()
relay = '/app/orders/1234'
query = 'SAMLRequest=' + urllib.parse.quote(saml_request, safe='') + '&RelayState=' + urllib.parse.quote(relay, safe='')
redirect_url = f'{PF}/idp/SSO.saml2?{query}'
# signed redirect: sign "SAMLRequest=..&RelayState=..&SigAlg=.." with the SP key (here: lab key for demo)
sigalg = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'
to_sign = query + '&SigAlg=' + urllib.parse.quote(sigalg, safe='')
pk = serialization.load_pem_private_key(KEY, None)
sig = base64.b64encode(pk.sign(to_sign.encode(), padding.PKCS1v15(), hashes.SHA256())).decode()
signed_url = f'{PF}/idp/SSO.saml2?{to_sign}&Signature={urllib.parse.quote(sig, safe="")}'
# decode it back like an IdP would
q = urllib.parse.parse_qs(urllib.parse.urlparse(redirect_url).query)
decoded = zlib.decompress(base64.b64decode(q['SAMLRequest'][0]), -15).decode()

out['redirect'] = '\n'.join([
    '# 1) SP builds an AuthnRequest (XML)',
    pretty(authn).rstrip(),
    '',
    f'# 2) HTTP-Redirect encoding: DEFLATE ({len(authn_min)} -> {len(deflated)} bytes) -> Base64 -> URL-encode',
    'SAMLRequest = ' + saml_request[:88] + '...',
    '',
    '# 3) Browser is redirected (HTTP 302) to:',
    textwrap.fill(redirect_url, 110),
    '',
    '# 4) Signed variant (Signed AuthnRequests): query also carries SigAlg + Signature',
    textwrap.fill(signed_url[:260] + '...', 110),
    '',
    '# 5) IdP decodes: URL-decode -> Base64-decode -> INFLATE',
    decoded[:120] + '...',
    f'RelayState = {q["RelayState"][0]}',
])

# ---------------------------------------------------------------- 2. Signed SAML Response (HTTP-POST)
resp_id, asrt_id = '_' + secrets.token_hex(16), '_' + secrets.token_hex(16)
nb, na = NOW - dt.timedelta(minutes=5), NOW + dt.timedelta(minutes=5)
response = f'''<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
 ID="{resp_id}" Version="2.0" IssueInstant="{iso(NOW)}" Destination="{SP_ACS}" InResponseTo="{req_id}">
 <saml:Issuer>{IDP_ENTITY}</saml:Issuer>
 <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
 <saml:Assertion ID="{asrt_id}" Version="2.0" IssueInstant="{iso(NOW)}">
  <saml:Issuer>{IDP_ENTITY}</saml:Issuer>
  <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="placeholder"/>
  <saml:Subject>
   <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified">testa</saml:NameID>
   <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
    <saml:SubjectConfirmationData InResponseTo="{req_id}" NotOnOrAfter="{iso(na)}" Recipient="{SP_ACS}"/>
   </saml:SubjectConfirmation>
  </saml:Subject>
  <saml:Conditions NotBefore="{iso(nb)}" NotOnOrAfter="{iso(na)}">
   <saml:AudienceRestriction><saml:Audience>{SP_ENTITY}</saml:Audience></saml:AudienceRestriction>
  </saml:Conditions>
  <saml:AuthnStatement AuthnInstant="{iso(NOW)}" SessionIndex="{asrt_id}">
   <saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>
  </saml:AuthnStatement>
  <saml:AttributeStatement>
   <saml:Attribute Name="email"><saml:AttributeValue>testa@pingfed.lab</saml:AttributeValue></saml:Attribute>
   <saml:Attribute Name="memberOf"><saml:AttributeValue>insgc</saml:AttributeValue></saml:Attribute>
  </saml:AttributeStatement>
 </saml:Assertion>
</samlp:Response>'''
root = etree.fromstring(response.encode())
assertion = root.find('{urn:oasis:names:tc:SAML:2.0:assertion}Assertion')
signed_assertion = XMLSigner(signature_algorithm='rsa-sha256', digest_algorithm='sha256',
                             c14n_algorithm='http://www.w3.org/2001/10/xml-exc-c14n#').sign(
    assertion, key=KEY, cert=CERT, reference_uri=asrt_id)
root.replace(assertion, signed_assertion)
signed_xml = etree.tostring(root)
open(os.path.join(HERE, 'saml-response-signed.xml'), 'wb').write(signed_xml)

# verify (as the SP would, with the IdP signing certificate from metadata)
def verify(xml_bytes):
    try:
        r = XMLVerifier().verify(xml_bytes, x509_cert=CERT.decode(), expect_references=1)
        return 'VALID - signed element: ' + etree.QName(r.signed_xml).localname
    except InvalidSignature as e:
        return 'INVALID - ' + str(e).split('\n')[0][:80]

tampered = signed_xml.replace(b'>testa<', b'>admin<')
# show the signature block, abbreviated
sig_el = signed_assertion.find('{http://www.w3.org/2000/09/xmldsig#}Signature')
import copy
sig_copy = copy.deepcopy(sig_el)
for c in sig_copy.iter('{http://www.w3.org/2000/09/xmldsig#}X509Certificate'):
    c.text = ''.join(c.text.split())[:64] + '...(IdP signing certificate, Base64)'
for c in sig_copy.iter('{http://www.w3.org/2000/09/xmldsig#}SignatureValue'):
    c.text = ''.join(c.text.split())[:64] + '...'
sig_txt = pretty(etree.tostring(sig_copy)).replace(' xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"', '')
sig_lines = []
for line in sig_txt.splitlines():
    sig_lines.append(line)
post_b64 = base64.b64encode(signed_xml).decode()
out['response'] = '\n'.join([
    '# 1) PingFederate builds the Response + Assertion, then signs the Assertion (XML-DSig, RSA-SHA256)',
    '# <ds:Signature> inside the signed Assertion (values shortened):',
    *sig_lines,
    '',
    '# 2) SP verifies with the IdP signing certificate from metadata',
    'original  -> ' + verify(signed_xml),
    'tampered  -> ' + verify(tampered) + '   (NameID changed testa -> admin)',
])
out['post'] = '\n'.join([
    '# HTTP-POST binding: the IdP returns this page; JavaScript auto-submits it to the SP ACS URL',
    '<html><body onload="document.forms[0].submit()">',
    f'  <form method="POST" action="{SP_ACS}">',
    f'    <input type="hidden" name="SAMLResponse" value="{post_b64[:60]}...({len(post_b64)} chars)"/>',
    f'    <input type="hidden" name="RelayState"  value="{relay}"/>',
    '    <noscript><button type="submit">Continue</button></noscript>',
    '  </form>',
    '</body></html>',
    '',
    '# Base64-decoded SAMLResponse starts with:',
    base64.b64decode(post_b64)[:150].decode() + '...',
])

# ---------------------------------------------------------------- 3. Artifact binding
source_id = hashlib.sha1(IDP_ENTITY.encode()).digest()
handle = secrets.token_bytes(20)
artifact = base64.b64encode(b'\x00\x04' + b'\x00\x00' + source_id + handle).decode()
out['artifact'] = '\n'.join([
    '# SAML 2.0 artifact = Base64( TypeCode 0x0004 | EndpointIndex | SourceID | MessageHandle )',
    f'TypeCode      : 0004',
    f'EndpointIndex : 0000',
    f'SourceID      : {source_id.hex()}   = SHA-1("{IDP_ENTITY}")',
    f'MessageHandle : {handle.hex()}   (random, one-time)',
    f'SAMLart       : {artifact}',
    '',
    '# 1) Front channel (browser): only the small artifact travels',
    f'GET {SP_ACS}?SAMLart={urllib.parse.quote(artifact, safe="")}&RelayState={urllib.parse.quote(relay, safe="")}',
    '',
    '# 2) Back channel (SP server -> IdP, SOAP over TLS): the SP exchanges it for the real message',
    f'POST {PF}/idp/ARS.ssaml2',
    '<samlp:ArtifactResolve ID="_a1" Version="2.0" IssueInstant="..." Destination="' + PF + '/idp/ARS.ssaml2">',
    f'  <saml:Issuer>{SP_ENTITY}</saml:Issuer>',
    f'  <samlp:Artifact>{artifact}</samlp:Artifact>',
    '</samlp:ArtifactResolve>',
    '# 3) IdP answers with <samlp:ArtifactResponse> containing the full signed <samlp:Response>',
])

# ---------------------------------------------------------------- 4. IdP metadata
md = f'''<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="{IDP_ENTITY}">
 <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol" WantAuthnRequestsSigned="false">
  <md:KeyDescriptor use="signing">
   <ds:KeyInfo><ds:X509Data><ds:X509Certificate>{CERT_B64[:48]}...</ds:X509Certificate></ds:X509Data></ds:KeyInfo>
  </md:KeyDescriptor>
  <md:ArtifactResolutionService Binding="urn:oasis:names:tc:SAML:2.0:bindings:SOAP" Location="{PF}/idp/ARS.ssaml2" index="0"/>
  <md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="{PF}/idp/SLO.saml2"/>
  <md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="{PF}/idp/SLO.saml2"/>
  <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified</md:NameIDFormat>
  <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="{PF}/idp/SSO.saml2"/>
  <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="{PF}/idp/SSO.saml2"/>
  <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Artifact" Location="{PF}/idp/SSO.saml2"/>
 </md:IDPSSODescriptor>
 <md:ContactPerson contactType="administrative"><md:Company>PingFed Lab</md:Company></md:ContactPerson>
</md:EntityDescriptor>'''
out['metadata'] = pretty(md).rstrip()

for k, v in out.items():
    open(os.path.join(HERE, f'out-{k}.txt'), 'w', encoding='utf-8').write(v + '\n')
    print(f'===== {k} =====\n{v}\n')
