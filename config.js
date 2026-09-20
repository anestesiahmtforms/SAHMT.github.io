// Pacote de produção preparado. Atualizar o backend unificado antes de publicar o frontend.
// firebaseConfig é público; nunca colocar chave da IA ou conta de serviço aqui.
export const CONFIG=Object.freeze({
  version:'4.0.0',environment:'production',authMode:'firebase',
  apiUrl:'https://script.google.com/macros/s/AKfycbwgER05yD9Bwq0Fqdn3C9HQXW3Jr8w6m5JeZh6JIwonUnVhFjRNc57x6oNk59ByXqbN/exec',timeoutMs:30000,
  firebase:Object.freeze({
    apiKey:'AIzaSyDg7plEPhaIieyDP3z462gxG9cY_OQCzvA',authDomain:'sahmt-17a16.firebaseapp.com',
    projectId:'sahmt-17a16',storageBucket:'sahmt-17a16.firebasestorage.app',
    messagingSenderId:'1072832154794',appId:'1:1072832154794:web:38e8e627d4189ebb0a14d3',measurementId:'G-5H61DLELCR'
  })
});
