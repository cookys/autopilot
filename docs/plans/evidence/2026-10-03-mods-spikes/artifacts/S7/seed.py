import json
real=json.load(open('/home/cookys/.claude.json'))
S='$C1'
d={'hasCompletedOnboarding':True,'theme':'dark','lastOnboardingVersion':real.get('lastOnboardingVersion')}
if 'oauthAccount' in real: d['oauthAccount']=real['oauthAccount']
d['projects']={S+'/proj':{'hasTrustDialogAccepted':True,'hasCompletedProjectOnboarding':True,'allowedTools':[]},S+'/proj/sub':{'hasTrustDialogAccepted':True,'hasCompletedProjectOnboarding':True,'allowedTools':[]}}
json.dump(d,open(S+'/claude-config/.claude.json','w'),indent=1)
print(sorted(d))
