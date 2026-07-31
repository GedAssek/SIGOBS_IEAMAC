const fs = require('fs');
async function test() {
  try {
    const API_BASE = 'https://pans-ops.skovichvps.cloud-ip.cc/api/v1';
    const loginRes = await fetch(API_BASE + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@pans-ops.local', password: 'password123' })
    });
    const loginData = await loginRes.json();
    const token = loginData.data.token;
    
    const obsRes = await fetch(API_BASE + '/obstacles', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const obsData = await obsRes.json();
    const obs = obsData.data.find(o => o.permanence === 'Permanent');
    
    if (!obs) {
      console.log('No permanent obstacle found');
      return;
    }
    console.log('Found obstacle:', obs._id);
    
    const patchPayload = { permanence: 'Temporaire', date_echeance: '2027-01-01T00:00:00.000Z' };
    console.log('Sending PATCH', patchPayload);
    
    const patchRes = await fetch(API_BASE + '/obstacles/' + obs._id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(patchPayload)
    });
    const patchData = await patchRes.json();
    console.log('PATCH RESPONSE (date_echeance):', JSON.stringify(patchData, null, 2));

    if (!patchData.success) {
      // Try with date_expiration just in case
      const patchPayload2 = { permanence: 'Temporaire', date_expiration: '2027-01-01T00:00:00.000Z' };
      console.log('Sending PATCH with date_expiration', patchPayload2);
      const patchRes2 = await fetch(API_BASE + '/obstacles/' + obs._id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(patchPayload2)
      });
      console.log('PATCH RESPONSE (date_expiration):', JSON.stringify(await patchRes2.json(), null, 2));
    }
  } catch (e) {
    console.error(e);
  }
}
test();
