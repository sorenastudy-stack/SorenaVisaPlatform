const fs = require('fs');
const path = require('path');

const content = `'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const STEPS = ['Personal Info', 'Education', 'Study Plan', 'Financial & Intent'];

export default function EligibilityPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  console.log('Current step:', step);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState('');
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '', nationality: '', age: '',
    highestQualification: '', englishTestType: '', englishTestSpecify: '', englishOverallScore: '',
    studyLevel: '', fieldOfStudy: '', preferredStartDate: '',
    financialLevel: '', estimatedBudgetNZD: '', visaRejectionCount: '', studyIntent: '',
  });

  const u = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    setLoading(true);
    setError('');
    try {
      const payload = {
        fullName: form.firstName && form.lastName ? form.firstName + ' ' + form.lastName : form.firstName || form.lastName || '',
        email: form.email,
        phone: form.phone,
        nationality: form.nationality,
        highestQualification: form.highestQualification,
        englishTestType: form.englishTestType,
        englishTestSpecify: form.englishTestSpecify,
        englishOverallScore: form.englishOverallScore ? Number(form.englishOverallScore) : undefined,
        preferredLevel: form.studyLevel,
        fieldOfStudy: form.fieldOfStudy,
        preferredStartDate: form.preferredStartDate,
        financialLevel: form.financialLevel,
        estimatedBudgetNZD: form.estimatedBudgetNZD ? Number(form.estimatedBudgetNZD) : undefined,
        visaRejectionCount: form.visaRejectionCount ? Number(form.visaRejectionCount) : 0,
        studyIntent: form.studyIntent,
        destination: 'New Zealand',
      };
      const res = await fetch('https://sorenavisaplatform-production.up.railway.app/public/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Submission failed');
      setScore(data.scoreBand || 'medium');
      setSubmitted(true);
    } catch (e) {
      setError(e.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div style={{minHeight:'100vh',background:'linear-gradient(135deg,#0a2342 0%,#0d4f6e 60%,#0a7a6e 100%)',display:'flex',alignItems:'center',justifyContent:'center',padding:'40px 24px'}}>
        <div style={{background:'#fff',borderRadius:16,padding:'48px',width:'100%',maxWidth:620,boxShadow:'0 20px 60px rgba(0,0,0,0.2)',textAlign:'center'}}>
          <div style={{fontSize:'3rem',marginBottom:16}}>✓</div>
          <h1 style={{fontSize:'1.9rem',fontWeight:800,color:'#0a2342',marginBottom:8}}>Eligibility Check Complete</h1>
          <p style={{color:'#5a6a7a',marginBottom:24}}>Your eligibility score: <strong>{score}</strong></p>
          <button onClick={()=>router.push('/')} style={{padding:'12px 32px',background:'#0d7a6e',color:'#fff',border:'none',borderRadius:8,fontWeight:700,cursor:'pointer'}}>Back to Home</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{minHeight:'100vh',background:'linear-gradient(135deg,#0a2342 0%,#0d4f6e 60%,#0a7a6e 100%)',display:'flex',alignItems:'center',justifyContent:'center',padding:'40px 24px'}}>
      <div style={{background:'#fff',borderRadius:16,padding:'48px',width:'100%',maxWidth:620,boxShadow:'0 20px 60px rgba(0,0,0,0.2)'}}>
        <div style={{textAlign:'center',marginBottom:36}}>
          <div style={{display:'inline-block',background:'rgba(13,122,110,0.1)',color:'#0d7a6e',fontSize:'0.75rem',fontWeight:700,letterSpacing:2,padding:'5px 14px',borderRadius:20,marginBottom:12}}>FREE ELIGIBILITY CHECK</div>
          <h1 style={{fontSize:'1.9rem',fontWeight:800,color:'#0a2342',marginBottom:8}}>Check Your Eligibility</h1>
          <p style={{color:'#5a6a7a'}}>Takes 3 minutes. No payment required.</p>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:40}}>
          {STEPS.map((s,i) => (
            <div key={s} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:6,flex:1}}>
              <div style={{width:36,height:36,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:'0.9rem',background:i<=step?'#0d7a6e':'#e2e8f0',color:i<=step?'#fff':'#94a3b8'}}>{i<step?'✓':i+1}</div>
              <span style={{fontSize:'0.75rem',fontWeight:600,color:i<=step?'#0d7a6e':'#94a3b8'}}>{s}</span>
            </div>
          ))}
        </div>
        {step===0 && <div>
          <h2 style={{fontSize:'1.2rem',fontWeight:700,color:'#0a2342',marginBottom:24}}>Personal Information</h2>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            <F label="First Name" value={form.firstName} onChange={(v)=>u('firstName',v)} placeholder="Ahmad" />
            <F label="Last Name" value={form.lastName} onChange={(v)=>u('lastName',v)} placeholder="Karimi" />
          </div>
          <F label="Email" value={form.email} onChange={(v)=>u('email',v)} placeholder="you@email.com" type="email" />
          <F label="Phone" value={form.phone} onChange={(v)=>u('phone',v)} placeholder="+64 21 000 0000" />
          <S label="Nationality" value={form.nationality} onChange={(v)=>u('nationality',v)} options={['Iranian','Indian','Pakistani','Filipino','Chinese','Saudi','Other']} />
          <S label="Age Range" value={form.age} onChange={(v)=>u('age',v)} options={['18-24','25-30','31-35','36-40','40+']} />
        </div>}
        {step===1 && <div>
          <h2 style={{fontSize:'1.2rem',fontWeight:700,color:'#0a2342',marginBottom:24}}>Education and English</h2>
          <S label="Highest Qualification" value={form.highestQualification} onChange={(v)=>u('highestQualification',v)} options={['HIGH_SCHOOL','DIPLOMA','BACHELOR','MASTER','PHD']} />
          <S label="English Test Type" value={form.englishTestType} onChange={(v)=>u('englishTestType',v)} options={['IELTS','TOEFL','PTE','Duolingo','Other','None']} />
          {form.englishTestType === 'Other' && <F label="Please specify your English test" value={form.englishTestSpecify || ''} onChange={(v)=>u('englishTestSpecify',v)} placeholder="e.g. Cambridge, BULATS" />}
          <F label="English Score" value={form.englishOverallScore} onChange={(v)=>u('englishOverallScore',v)} placeholder="e.g. 6.5" />
        </div>}
        {step===2 && <div>
          <h2 style={{fontSize:'1.2rem',fontWeight:700,color:'#0a2342',marginBottom:24}}>Study Plan</h2>
          <S label="Study Level" value={form.studyLevel} onChange={(v)=>u('studyLevel',v)} options={['Diploma','Bachelors','Masters','PhD','Certificate']} />
          <S label="Field of Study" value={form.fieldOfStudy} onChange={(v)=>u('fieldOfStudy',v)} options={['Business','IT','Engineering','Health','Hospitality','Education','Arts','Other']} />
          <S label="Preferred Start Date" value={form.preferredStartDate} onChange={(v)=>u('preferredStartDate',v)} options={['2025-07','2025-11','2026-02','2026-07']} />
        </div>}
        {step===3 && <div>
          <h2 style={{fontSize:'1.2rem',fontWeight:700,color:'#0a2342',marginBottom:24}}>Financial & Intent</h2>
          <S label="Financial Level" value={form.financialLevel} onChange={(v)=>u('financialLevel',v)} options={['Low','Medium','High']} />
          <p style={{fontSize:'0.85rem',color:'#6b7280',marginBottom:20,marginTop:-8}}>Low = limited funds, may need scholarship or part-time work • Medium = can cover basic costs, may need some support • High = fully self-funded, strong financial position</p>
          <F label="Estimated Budget NZD" value={form.estimatedBudgetNZD} onChange={(v)=>u('estimatedBudgetNZD',v)} placeholder="e.g. 30000" type="number" />
          <S label="Previous Visa Rejections" value={form.visaRejectionCount} onChange={(v)=>u('visaRejectionCount',v)} options={['0','1','2','3']} />
          <F label="Study Intent" value={form.studyIntent} onChange={(v)=>u('studyIntent',v)} placeholder="Why do you want to study in NZ?" multiline={true} />
        </div>}
        {error && <div style={{background:'#fee2e2',color:'#dc2626',padding:'12px 16px',borderRadius:8,marginBottom:16,fontSize:'0.9rem'}}>{error}</div>}
        <div style={{display:'flex',alignItems:'center',gap:12,marginTop:24}}>
          {step>0 && <button onClick={()=>setStep(s=>s-1)} style={{padding:'12px 24px',border:'1.5px solid #e2e8f0',borderRadius:8,background:'#fff',color:'#5a6a7a',fontWeight:600,cursor:'pointer'}}>Back</button>}
          <div style={{flex:1}} />
          {step<STEPS.length-1
            ? <button onClick={()=>setStep(s=>s+1)} style={{padding:'12px 32px',background:'#0d7a6e',color:'#fff',border:'none',borderRadius:8,fontWeight:700,cursor:'pointer'}}>Next</button>
            : <button onClick={submit} disabled={loading} style={{padding:'12px 32px',background:'#0d7a6e',color:'#fff',border:'none',borderRadius:8,fontWeight:700,cursor:'pointer'}}>{loading?'Submitting...':'Check My Eligibility'}</button>
          }
        </div>
      </div>
    </div>
  );
}

function F({label,value,onChange,placeholder,type,multiline}) {
  const s = {width:'100%',padding:'11px 14px',border:'1.5px solid #e2e8f0',borderRadius:8,fontSize:'0.95rem',color:'#2c3e50',outline:'none',boxSizing:'border-box',fontFamily:'inherit',marginBottom:20};
  return <div><label style={{display:'block',fontSize:'0.88rem',fontWeight:600,color:'#2c3e50',marginBottom:6}}>{label}</label>{multiline?<textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{...s,height:100,resize:'vertical'}}/>:<input type={type||'text'} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={s}/>}</div>;
}

function S({label,value,onChange,options}) {
  const s = {width:'100%',padding:'11px 14px',border:'1.5px solid #e2e8f0',borderRadius:8,fontSize:'0.95rem',color:'#2c3e50',outline:'none',boxSizing:'border-box',fontFamily:'inherit'};
  return <div style={{marginBottom:20}}><label style={{display:'block',fontSize:'0.88rem',fontWeight:600,color:'#2c3e50',marginBottom:6}}>{label}</label><select value={value} onChange={e=>onChange(e.target.value)} style={s}><option value=''>Select...</option>{options.map(o=><option key={o} value={o}>{o}</option>)}</select></div>;
}
`;

const filePath = path.join(__dirname, 'src', 'app', 'eligibility', 'page.tsx');
fs.writeFileSync(filePath, content, 'utf8');
console.log('✓ Written to ' + filePath);
